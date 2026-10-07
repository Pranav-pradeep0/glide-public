package com.glide.app.player

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.nio.ByteOrder
import java.util.Locale
import kotlin.concurrent.thread

/**
 * JS bridge for [SubtitleAligner].
 *
 * Provides native PCM audio decoding directly from video files via [MediaExtractor] and [MediaCodec],
 * eliminating the need for heavy external extraction tools like FFmpeg.
 */
@ReactModule(name = SubtitleSyncModule.NAME)
class SubtitleSyncModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

    companion object {
        const val NAME = "SubtitleSyncModule"
    }

    override fun getName() = NAME

    private data class DecodedAudio(
        val pcm: ShortArray,
        val sampleRate: Int,
        val actualStartS: Double
    )

    /**
     * Decodes an audio window of up to [durationS] starting at [windowStartS] into 16-bit mono PCM,
     * isolating the dialogue/center channel.
     */
    private fun decodeAudioWindow(videoPath: String, windowStartS: Double, durationS: Double = 300.0): DecodedAudio? {
        val context = reactApplicationContext
        val uri = Uri.parse(videoPath)
        var pfd: ParcelFileDescriptor? = null
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null

        try {
            if (videoPath.startsWith("content://")) {
                pfd = context.contentResolver.openFileDescriptor(uri, "r")
                if (pfd != null) {
                    extractor.setDataSource(pfd.fileDescriptor)
                } else {
                    extractor.setDataSource(context, uri, null)
                }
            } else {
                val cleanPath = if (videoPath.startsWith("file://")) uri.path ?: videoPath.removePrefix("file://") else videoPath
                extractor.setDataSource(cleanPath)
            }

            var audioTrackIndex = -1
            var audioFormat: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
                if (mime.startsWith("audio/")) {
                    audioTrackIndex = i
                    audioFormat = format
                    break
                }
            }

            if (audioTrackIndex == -1 || audioFormat == null) {
                return null
            }

            extractor.selectTrack(audioTrackIndex)
            val mime = audioFormat.getString(MediaFormat.KEY_MIME) ?: return null

            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(audioFormat, null, null, 0)
            codec.start()

            val windowStartUs = (windowStartS * 1_000_000).toLong().coerceAtLeast(0L)
            val windowEndUs = windowStartUs + (durationS * 1_000_000).toLong()

            extractor.seekTo(windowStartUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

            var sampleRate = if (audioFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                audioFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            } else {
                44100
            }
            var channelCount = if (audioFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                audioFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            } else {
                2
            }
            var pcmEncoding = if (audioFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                audioFormat.getInteger(MediaFormat.KEY_PCM_ENCODING)
            } else {
                AudioFormat.ENCODING_PCM_16BIT
            }

            val bufferInfo = MediaCodec.BufferInfo()
            val kTimeoutUs = 5000L
            var sawInputEOS = false
            var isEOS = false
            var noOutputCount = 0
            val maxNoOutputCount = 200

            val chunks = ArrayList<ShortArray>()
            var totalShorts = 0
            var actualStartUs: Long? = null

            while (!isEOS && noOutputCount < maxNoOutputCount) {
                if (!sawInputEOS) {
                    val inputIndex = codec.dequeueInputBuffer(kTimeoutUs)
                    if (inputIndex >= 0) {
                        val inputBuffer = codec.getInputBuffer(inputIndex)
                        if (inputBuffer != null) {
                            val sampleSize = extractor.readSampleData(inputBuffer, 0)
                            if (sampleSize < 0) {
                                codec.queueInputBuffer(inputIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                sawInputEOS = true
                            } else {
                                val sampleTime = extractor.sampleTime
                                if (sampleTime > windowEndUs + 2_000_000L) {
                                    codec.queueInputBuffer(inputIndex, 0, sampleSize, sampleTime, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                    sawInputEOS = true
                                } else {
                                    codec.queueInputBuffer(inputIndex, 0, sampleSize, sampleTime, 0)
                                    extractor.advance()
                                }
                            }
                        }
                    }
                }

                val outputIndex = codec.dequeueOutputBuffer(bufferInfo, kTimeoutUs)
                if (outputIndex >= 0) {
                    noOutputCount = 0
                    if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        isEOS = true
                    }
                    val outputBuffer = codec.getOutputBuffer(outputIndex)
                    if (outputBuffer != null && bufferInfo.size > 0 && channelCount > 0 && sampleRate > 0) {
                        outputBuffer.position(bufferInfo.offset)
                        outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
                        outputBuffer.order(ByteOrder.LITTLE_ENDIAN)

                        val pts = bufferInfo.presentationTimeUs
                        val isFloat = (pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT)
                        val bytesPerSample = if (isFloat) 4 else 2
                        val bytesPerFrame = channelCount * bytesPerSample
                        val totalFrames = bufferInfo.size / bytesPerFrame
                        val durationUs = (totalFrames * 1_000_000L) / sampleRate

                        if (pts + durationUs > windowStartUs && pts < windowEndUs) {
                            val startFrame = if (pts < windowStartUs) {
                                (((windowStartUs - pts) * sampleRate) / 1_000_000L).toInt().coerceIn(0, totalFrames)
                            } else {
                                0
                            }
                            val endFrame = if (pts + durationUs > windowEndUs) {
                                (((windowEndUs - pts) * sampleRate) / 1_000_000L).toInt().coerceIn(startFrame, totalFrames)
                            } else {
                                totalFrames
                            }
                            val framesToExtract = endFrame - startFrame

                            if (framesToExtract > 0) {
                                if (actualStartUs == null) {
                                    actualStartUs = pts + (startFrame * 1_000_000L) / sampleRate
                                }

                                val chunk = ShortArray(framesToExtract)
                                if (isFloat) {
                                    val floatBuf = outputBuffer.asFloatBuffer()
                                    for (f in 0 until framesToExtract) {
                                        val frameIdx = startFrame + f
                                        val sFloat: Float = when {
                                            channelCount >= 3 -> floatBuf.get(frameIdx * channelCount + 2) // center
                                            channelCount == 2 -> (floatBuf.get(frameIdx * 2) + floatBuf.get(frameIdx * 2 + 1)) / 2f
                                            else -> floatBuf.get(frameIdx)
                                        }
                                        chunk[f] = (sFloat.coerceIn(-1.0f, 1.0f) * 32767f).toInt().toShort()
                                    }
                                } else {
                                    val shortBuf = outputBuffer.asShortBuffer()
                                    for (f in 0 until framesToExtract) {
                                        val frameIdx = startFrame + f
                                        val sShort: Short = when {
                                            channelCount >= 3 -> shortBuf.get(frameIdx * channelCount + 2) // center
                                            channelCount == 2 -> ((shortBuf.get(frameIdx * 2).toInt() + shortBuf.get(frameIdx * 2 + 1).toInt()) / 2).toShort()
                                            else -> shortBuf.get(frameIdx)
                                        }
                                        chunk[f] = sShort
                                    }
                                }

                                chunks.add(chunk)
                                totalShorts += framesToExtract
                            }

                            if (endFrame < totalFrames || pts + durationUs >= windowEndUs) {
                                isEOS = true
                            }
                        } else if (pts >= windowEndUs) {
                            isEOS = true
                        }
                    }
                    codec.releaseOutputBuffer(outputIndex, false)
                } else if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    noOutputCount = 0
                    val newFormat = codec.outputFormat
                    if (newFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                        sampleRate = newFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    }
                    if (newFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                        channelCount = newFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    }
                    if (newFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                        pcmEncoding = newFormat.getInteger(MediaFormat.KEY_PCM_ENCODING)
                    }
                } else if (outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    noOutputCount++
                }
            }

            if (totalShorts == 0 || sampleRate <= 0) {
                return null
            }

            val targetRate = 8000
            val pcm: ShortArray
            val finalRate: Int
            if (sampleRate > targetRate) {
                val ratio = sampleRate.toDouble() / targetRate
                val targetSize = (totalShorts / ratio).toInt()
                pcm = ShortArray(targetSize)
                var currentShortIdx = 0
                var chunkIdx = 0
                for (i in 0 until targetSize) {
                    val targetSrcIdx = (i * ratio).toInt()
                    while (chunkIdx < chunks.size && currentShortIdx + chunks[chunkIdx].size <= targetSrcIdx) {
                        currentShortIdx += chunks[chunkIdx].size
                        chunkIdx++
                    }
                    if (chunkIdx < chunks.size) {
                        pcm[i] = chunks[chunkIdx][targetSrcIdx - currentShortIdx]
                    }
                }
                chunks.clear()
                finalRate = targetRate
            } else {
                pcm = ShortArray(totalShorts)
                var offset = 0
                for (chunk in chunks) {
                    System.arraycopy(chunk, 0, pcm, offset, chunk.size)
                    offset += chunk.size
                }
                chunks.clear()
                finalRate = sampleRate
            }

            val actualStartS = (actualStartUs ?: (windowStartS * 1_000_000).toLong()) / 1_000_000.0
            return DecodedAudio(pcm, finalRate, actualStartS)
        } finally {
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            try { extractor.release() } catch (_: Exception) {}
            try { pfd?.close() } catch (_: Exception) {}
        }
    }

    /**
     * Decodes audio directly from [videoPath] using MediaExtractor and MediaCodec, and aligns
     * cue times against the extracted speech band.
     */
    @ReactMethod
    fun alignVideo(videoPath: String, windowStartS: Double, starts: ReadableArray, ends: ReadableArray, promise: Promise) {
        thread(name = "subtitle-align-video") {
            try {
                val decoded = decodeAudioWindow(videoPath, windowStartS, 300.0)
                    ?: return@thread promise.resolve(null)

                val s = DoubleArray(starts.size()) { starts.getDouble(it) }
                val e = DoubleArray(ends.size()) { ends.getDouble(it) }

                val levels = SubtitleAligner.speechLevels(decoded.pcm, decoded.sampleRate)
                val result = SubtitleAligner.align(levels, decoded.actualStartS, s, e)
                    ?: return@thread promise.resolve(null)

                promise.resolve(Arguments.createMap().apply {
                    putDouble("delayMs", result.delayS * 1000)
                    putDouble("ratio", result.ratio)
                    putDouble("peakZ", result.peakZ)
                    putDouble("runnerUp", result.runnerUp)
                    putBoolean("confident", result.confident)
                    putBoolean("drift", result.drift)
                })
            } catch (t: Throwable) {
                promise.reject("E_ALIGN", t.message ?: "Alignment error", t)
            }
        }
    }

    /**
     * Align cue times (seconds) against the speech in [wavPath], a 16-bit PCM WAV (any channel count) whose first
     * sample is at [windowStartS]. Resolves null when there is too little to go on.
     */
    @ReactMethod
    fun align(wavPath: String, windowStartS: Double, starts: ReadableArray, ends: ReadableArray, promise: Promise) {
        thread(name = "subtitle-align") {
            try {
                val wav = SubtitleAligner.pcmFromWav(File(wavPath).readBytes())
                    ?: return@thread promise.reject("E_WAV", "Not a 16-bit PCM WAV")
                val s = DoubleArray(starts.size()) { starts.getDouble(it) }
                val e = DoubleArray(ends.size()) { ends.getDouble(it) }
                val result = SubtitleAligner.align(
                    SubtitleAligner.speechLevels(wav.dialogue(), wav.sampleRate), windowStartS, s, e,
                ) ?: return@thread promise.resolve(null)
                promise.resolve(Arguments.createMap().apply {
                    putDouble("delayMs", result.delayS * 1000)
                    putDouble("ratio", result.ratio)
                    putDouble("peakZ", result.peakZ)
                    putDouble("runnerUp", result.runnerUp)
                    putBoolean("confident", result.confident)
                    putBoolean("drift", result.drift)
                })
            } catch (e: Exception) {
                promise.reject("E_ALIGN", e)
            }
        }
    }

    /**
     * Extract stream and metadata information from [videoPath] using native MediaExtractor and MediaMetadataRetriever.
     */
    @ReactMethod
    fun getVideoMetadata(videoPath: String, promise: Promise) {
        thread(name = "video-metadata") {
            val context = reactApplicationContext
            val uri = Uri.parse(videoPath)
            var pfd: ParcelFileDescriptor? = null
            val extractor = MediaExtractor()
            try {
                if (videoPath.startsWith("content://")) {
                    pfd = context.contentResolver.openFileDescriptor(uri, "r")
                    if (pfd != null) {
                        extractor.setDataSource(pfd.fileDescriptor)
                    } else {
                        extractor.setDataSource(context, uri, null)
                    }
                } else {
                    val cleanPath = if (videoPath.startsWith("file://")) uri.path ?: videoPath.removePrefix("file://") else videoPath
                    extractor.setDataSource(cleanPath)
                }

                var videoInfo: String? = null
                var audioInfo: String? = null
                var bitrate: String? = null
                val subtitleTracks = Arguments.createArray()

                var retriever: MediaMetadataRetriever? = null
                try {
                    retriever = MediaMetadataRetriever()
                    if (pfd != null) {
                        retriever.setDataSource(pfd.fileDescriptor)
                    } else if (videoPath.startsWith("content://")) {
                        retriever.setDataSource(context, uri)
                    } else {
                        val cleanPath = if (videoPath.startsWith("file://")) uri.path ?: videoPath.removePrefix("file://") else videoPath
                        retriever.setDataSource(cleanPath)
                    }
                    val bVal = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toLongOrNull()
                    if (bVal != null && bVal > 0) {
                        bitrate = if (bVal > 1_000_000) String.format(Locale.US, "%.1f Mbps", bVal / 1_000_000.0)
                                  else String.format(Locale.US, "%d Kbps", bVal / 1000)
                    }
                } catch (_: Exception) {} finally {
                    try { retriever?.release() } catch (_: Exception) {}
                }

                for (i in 0 until extractor.trackCount) {
                    val format = extractor.getTrackFormat(i)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
                    if (mime.startsWith("video/") && videoInfo == null) {
                        val codecName = mime.substringAfter("video/").replace("x-vnd.on2.", "").replace("avc", "H264").replace("hevc", "HEVC").uppercase(Locale.US)
                        val fps = if (format.containsKey(MediaFormat.KEY_FRAME_RATE)) "${format.getInteger(MediaFormat.KEY_FRAME_RATE)} fps" else null
                        videoInfo = listOfNotNull(codecName, fps).joinToString(" · ")
                    } else if (mime.startsWith("audio/") && audioInfo == null) {
                        val codecName = mime.substringAfter("audio/").replace("mp4a-latm", "AAC").uppercase(Locale.US)
                        val rate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) "${format.getInteger(MediaFormat.KEY_SAMPLE_RATE) / 1000} kHz" else null
                        audioInfo = listOfNotNull(codecName, rate).joinToString(" · ")
                    } else if (mime.startsWith("text/") || mime.startsWith("application/") || mime.contains("sub") || mime.contains("pgs") || mime.contains("tx3g")) {
                        val lang = (if (format.containsKey(MediaFormat.KEY_LANGUAGE)) format.getString(MediaFormat.KEY_LANGUAGE) else "UND")?.uppercase(Locale.US) ?: "UND"
                        val codec = when {
                            mime.contains("subrip") || mime.contains("srt") -> "SRT"
                            mime.contains("pgs") -> "PGS"
                            mime.contains("ssa") || mime.contains("ass") -> "SSA"
                            mime.contains("vtt") -> "VTT"
                            mime.contains("tx3g") || mime.contains("quicktime") -> "MOV"
                            else -> mime.substringAfterLast("/").uppercase(Locale.US)
                        }
                        subtitleTracks.pushMap(Arguments.createMap().apply {
                            putString("lang", lang)
                            putString("codec", codec)
                            putInt("index", i)
                        })
                    }
                }

                promise.resolve(Arguments.createMap().apply {
                    putString("video", videoInfo)
                    putString("audio", audioInfo)
                    putString("bitrate", bitrate)
                    putArray("subtitles", subtitleTracks)
                })
            } catch (e: Exception) {
                promise.resolve(null)
            } finally {
                extractor.release()
                try { pfd?.close() } catch (_: Exception) {}
            }
        }
    }

    /**
     * Enumerates embedded subtitle tracks in [videoPath] using Media3 MetadataRetriever with MediaExtractor fallback.
     */
    @ReactMethod
    fun getSubtitleTracks(videoPath: String, promise: Promise) {
        thread(name = "subtitle-tracks") {
            val context = reactApplicationContext
            val uri = Uri.parse(videoPath)
            var pfd: ParcelFileDescriptor? = null
            val extractor = MediaExtractor()

            try {
                if (videoPath.startsWith("content://")) {
                    pfd = context.contentResolver.openFileDescriptor(uri, "r")
                    if (pfd != null) {
                        extractor.setDataSource(pfd.fileDescriptor)
                    } else {
                        extractor.setDataSource(context, uri, null)
                    }
                } else {
                    val cleanPath = if (videoPath.startsWith("file://")) uri.path ?: videoPath.removePrefix("file://") else videoPath
                    extractor.setDataSource(cleanPath)
                }

                val tracksArray = Arguments.createArray()
                var subIndex = 0
                for (i in 0 until extractor.trackCount) {
                    val format = extractor.getTrackFormat(i)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
                    if (mime.startsWith("text/") || mime.startsWith("application/") ||
                        mime.contains("sub") || mime.contains("pgs") || mime.contains("tx3g")) {
                        val lang = if (format.containsKey(MediaFormat.KEY_LANGUAGE)) format.getString(MediaFormat.KEY_LANGUAGE) ?: "und" else "und"
                        val isBitmap = mime.contains("pgs") || mime.contains("vobsub") || mime.contains("dvd")
                        val codec = when {
                            mime.contains("subrip") || mime.contains("srt") -> "srt"
                            mime.contains("pgs") -> "pgs"
                            mime.contains("ssa") || mime.contains("ass") -> "ass"
                            mime.contains("vtt") -> "webvtt"
                            mime.contains("tx3g") || mime.contains("quicktime") -> "mov_text"
                            else -> mime.substringAfterLast("/")
                        }
                        val title = if (lang != "und") lang else "Subtitle ${subIndex + 1}"
                        val trackMap = Arguments.createMap().apply {
                            putInt("index", subIndex)
                            putString("codec", codec)
                            putString("language", lang)
                            putString("title", title)
                            putBoolean("isDefault", false)
                            putBoolean("isForced", false)
                            putBoolean("isBitmap", isBitmap)
                        }
                        tracksArray.pushMap(trackMap)
                        subIndex++
                    }
                }
                promise.resolve(tracksArray)
            } catch (e: Throwable) {
                promise.resolve(Arguments.createArray())
            } finally {
                try { extractor.release() } catch (_: Throwable) {}
                try { pfd?.close() } catch (_: Throwable) {}
            }
        }
    }
}
