package com.glide.app.audio

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import androidx.palette.graphics.Palette
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread

class MediaStoreAudioModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "MediaStoreAudioModule"

    data class ArtDetails(
        val uri: String?,
        val primaryColor: String?,
        val secondaryColor: String?,
        val onPrimaryColor: String? = null
    )

    data class PaletteColors(val primary: String?, val secondary: String?, val onPrimary: String?)

    data class SongRecord(
        val id: String,
        val title: String,
        val artist: String,
        val album: String,
        val albumId: String,
        val uri: String,
        val durationMs: Long,
        val artworkUri: String? = null
    )

    companion object {
        private const val TAG = "MediaStoreAudioModule"
        private val artExecutor = java.util.concurrent.Executors.newFixedThreadPool(2)
        private val songCache = java.util.concurrent.ConcurrentHashMap<String, SongRecord>()

        private val SONG_PROJECTION = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ARTIST_ID,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.TRACK,
            MediaStore.Audio.Media.YEAR,
            MediaStore.Audio.Media.DATE_ADDED
        )

        fun sanitizeMetadata(value: String?, fallback: String): String {
            if (value.isNullOrBlank() || value.equals("<unknown>", ignoreCase = true)) {
                return fallback
            }
            return value.trim()
        }

        fun extractPaletteColors(bitmap: Bitmap): PaletteColors {
            return try {
                val palette = Palette.from(bitmap).generate()
                val vibrant = palette.vibrantSwatch
                val dominant = palette.dominantSwatch
                val swatch = vibrant ?: dominant ?: palette.swatches.firstOrNull()
                val primaryInt = swatch?.rgb ?: palette.getVibrantColor(palette.getDominantColor(0))
                val darkInt = palette.darkVibrantSwatch?.rgb ?: palette.darkMutedSwatch?.rgb ?: palette.getDarkVibrantColor(palette.getDarkMutedColor(0))
                val titleTextColorInt = swatch?.titleTextColor ?: -1

                val primaryHex = if (primaryInt != 0) String.format("#%06X", 0xFFFFFF and primaryInt) else null
                val darkHex = if (darkInt != 0) String.format("#%06X", 0xFFFFFF and darkInt) else null
                val onPrimaryHex = if (swatch != null && titleTextColorInt != -1) String.format("#%06X", 0xFFFFFF and titleTextColorInt) else "#FFFFFF"
                PaletteColors(primaryHex, darkHex, onPrimaryHex)
            } catch (_: Exception) {
                PaletteColors(null, null, "#FFFFFF")
            }
        }

        fun savePalette(paletteFile: File, primary: String?, secondary: String?, onPrimary: String?) {
            try {
                paletteFile.writeText("${primary ?: ""}|${secondary ?: ""}|${onPrimary ?: ""}")
            } catch (_: Exception) {}
        }

        fun getArtworkDetails(context: Context, albumId: Long, songUriStr: String?): ArtDetails {
            if (albumId <= 0 && songUriStr.isNullOrEmpty()) return ArtDetails(null, null, null, null)

            val cacheDir = File(context.cacheDir, "album_art")
            if (!cacheDir.exists()) {
                cacheDir.mkdirs()
            }
            val cacheFile = File(cacheDir, "$albumId.jpg")
            val paletteFile = File(cacheDir, "$albumId.palette")

            if (cacheFile.exists() && cacheFile.length() > 0) {
                val uri = "file://${cacheFile.absolutePath}"
                if (paletteFile.exists() && paletteFile.length() > 0) {
                    try {
                        val parts = paletteFile.readText().split("|")
                        val primary = parts.getOrNull(0)?.takeIf { it.isNotEmpty() }
                        val secondary = parts.getOrNull(1)?.takeIf { it.isNotEmpty() }
                        val onPrimary = parts.getOrNull(2)?.takeIf { it.isNotEmpty() } ?: "#FFFFFF"
                        return ArtDetails(uri, primary, secondary, onPrimary)
                    } catch (_: Exception) {}
                }
                try {
                    val bitmap = BitmapFactory.decodeFile(cacheFile.absolutePath)
                    if (bitmap != null) {
                        val colors = extractPaletteColors(bitmap)
                        savePalette(paletteFile, colors.primary, colors.secondary, colors.onPrimary)
                        return ArtDetails(uri, colors.primary, colors.secondary, colors.onPrimary)
                    }
                } catch (_: Exception) {}
                return ArtDetails(uri, null, null, null)
            }

            try {
                var bitmap: Bitmap? = null

                // Strategy 1: ContentResolver loadThumbnail on API 29+ (Android 10+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && albumId > 0) {
                    val albumUri = ContentUris.withAppendedId(
                        MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI,
                        albumId
                    )
                    try {
                        bitmap = context.contentResolver.loadThumbnail(
                            albumUri,
                            Size(512, 512),
                            null
                        )
                    } catch (_: Exception) {}
                }

                // Strategy 2: MediaMetadataRetriever from songUri
                if (bitmap == null && !songUriStr.isNullOrEmpty()) {
                    val songUri = Uri.parse(songUriStr)
                    val retriever = MediaMetadataRetriever()
                    try {
                        retriever.setDataSource(context, songUri)
                        val rawBytes = retriever.embeddedPicture
                        if (rawBytes != null) {
                            bitmap = BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.size)
                        }
                    } catch (_: Exception) {}
                    finally {
                        try {
                            retriever.release()
                        } catch (_: Exception) {}
                    }
                }

                if (bitmap != null) {
                    FileOutputStream(cacheFile).use { out ->
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
                    }
                    val colors = extractPaletteColors(bitmap)
                    savePalette(paletteFile, colors.primary, colors.secondary, colors.onPrimary)
                    return ArtDetails("file://${cacheFile.absolutePath}", colors.primary, colors.secondary, colors.onPrimary)
                }
            } catch (_: Exception) {
                // ignore
            }

            return ArtDetails(null, null, null, null)
        }

        fun getArtworkUri(context: Context, albumId: Long, songUriStr: String?): String? {
            return getArtworkDetails(context, albumId, songUriStr).uri
        }

        fun getSongById(context: Context, id: String): SongRecord? {
            songCache[id]?.let { return it }

            try {
                val songId = id.toLongOrNull() ?: return null
                val songUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, songId)
                val resolver = context.contentResolver
                val cursor = resolver.query(
                    songUri,
                    SONG_PROJECTION,
                    null,
                    null,
                    null
                )
                cursor?.use { c ->
                    if (c.moveToFirst()) {
                        val titleCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                        val artistCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                        val albumCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                        val albumIdCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                        val durationCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                        val albumId = c.getLong(albumIdCol)

                        val artFile = File(context.cacheDir, "album_art/$albumId.jpg")
                        val artUri = if (artFile.exists() && artFile.length() > 0) {
                            "file://${artFile.absolutePath}"
                        } else null

                        val record = SongRecord(
                            id = id,
                            title = sanitizeMetadata(c.getString(titleCol), "Unknown Track"),
                            artist = sanitizeMetadata(c.getString(artistCol), "Unknown Artist"),
                            album = sanitizeMetadata(c.getString(albumCol), "Unknown Album"),
                            albumId = albumId.toString(),
                            uri = songUri.toString(),
                            durationMs = c.getLong(durationCol),
                            artworkUri = artUri
                        )
                        songCache[id] = record
                        return record
                    }
                }
            } catch (_: Exception) {}

            val fallbackUri = ContentUris.withAppendedId(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                id.toLongOrNull() ?: return null
            ).toString()
            val fallback = SongRecord(
                id = id,
                title = "Track $id",
                artist = "Unknown Artist",
                album = "Unknown Album",
                albumId = "",
                uri = fallbackUri,
                durationMs = 0L,
                artworkUri = null
            )
            songCache[id] = fallback
            return fallback
        }
    }

    @ReactMethod
    fun getSongs(promise: Promise) {
        thread(name = "glide-audio-songs-scan") {
            try {
                val resolver = reactContext.contentResolver
                val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.DURATION} >= 10000"
                val sortOrder = "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"

                val cursor = resolver.query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    SONG_PROJECTION,
                    selection,
                    null,
                    sortOrder
                )

                val resultList = Arguments.createArray()
                cursor?.use { c ->
                    val idCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                    val titleCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                    val artistCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                    val artistIdCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST_ID)
                    val albumCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                    val albumIdCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                    val durationCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                    val dataCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA)
                    val sizeCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
                    val trackCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
                    val yearCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)
                    val dateAddedCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)

                    while (c.moveToNext()) {
                        val songId = c.getLong(idCol)
                        val albumId = c.getLong(albumIdCol)
                        val durationMs = c.getLong(durationCol)
                        val contentUri = ContentUris.withAppendedId(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                            songId
                        ).toString()

                        val title = sanitizeMetadata(c.getString(titleCol), "Unknown Track")
                        val artist = sanitizeMetadata(c.getString(artistCol), "Unknown Artist")
                        val album = sanitizeMetadata(c.getString(albumCol), "Unknown Album")

                        val artFile = File(reactContext.cacheDir, "album_art/$albumId.jpg")
                        val artworkUri = if (artFile.exists() && artFile.length() > 0) {
                            "file://${artFile.absolutePath}"
                        } else null

                        songCache[songId.toString()] = SongRecord(
                            id = songId.toString(),
                            title = title,
                            artist = artist,
                            album = album,
                            albumId = albumId.toString(),
                            uri = contentUri,
                            durationMs = durationMs,
                            artworkUri = artworkUri
                        )

                        val map = Arguments.createMap().apply {
                            putString("id", songId.toString())
                            putString("title", title)
                            putString("artist", artist)
                            putString("artistId", c.getLong(artistIdCol).toString())
                            putString("album", album)
                            putString("albumId", albumId.toString())
                            putDouble("duration", durationMs / 1000.0) // seconds
                            putString("path", c.getString(dataCol) ?: "")
                            putString("uri", contentUri)
                            putDouble("size", c.getLong(sizeCol).toDouble())
                            putInt("trackNumber", c.getInt(trackCol))
                            putInt("year", c.getInt(yearCol))
                            putDouble("dateAdded", c.getLong(dateAddedCol).toDouble())

                            if (artworkUri != null) {
                                putString("artworkUri", artworkUri)
                                val paletteFile = File(reactContext.cacheDir, "album_art/$albumId.palette")
                                if (paletteFile.exists() && paletteFile.length() > 0) {
                                    try {
                                        val parts = paletteFile.readText().split("|")
                                        val primary = parts.getOrNull(0)?.takeIf { it.isNotEmpty() }
                                        if (primary != null) {
                                            putString("primaryColor", primary)
                                        }
                                    } catch (_: Exception) {}
                                }
                            } else {
                                putNull("artworkUri")
                            }
                        }
                        resultList.pushMap(map)
                    }
                }
                promise.resolve(resultList)
            } catch (e: Exception) {
                promise.reject("E_MEDIASTORE_SONGS", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getAlbumArt(albumId: String, songUriStr: String?, promise: Promise) {
        artExecutor.execute {
            try {
                val uri = getArtworkUri(reactContext, albumId.toLongOrNull() ?: 0L, songUriStr)
                promise.resolve(uri)
            } catch (e: Exception) {
                promise.resolve(null)
            }
        }
    }

    @ReactMethod
    fun getAlbumArtWithPalette(albumId: String, songUriStr: String?, promise: Promise) {
        artExecutor.execute {
            try {
                val details = getArtworkDetails(reactContext, albumId.toLongOrNull() ?: 0L, songUriStr)
                val map = Arguments.createMap().apply {
                    putString("artworkUri", details.uri)
                    putString("primaryColor", details.primaryColor)
                    putString("secondaryColor", details.secondaryColor)
                    putString("onPrimaryColor", details.onPrimaryColor)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.resolve(Arguments.createMap())
            }
        }
    }
}
