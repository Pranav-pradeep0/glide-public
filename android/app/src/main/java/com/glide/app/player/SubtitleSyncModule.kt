package com.glide.app.player

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecList
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

    /** Speech-band loudness of the window ([SubtitleAligner.FRAME_S] apart) and where it starts. */
    private data class DecodedLevels(
        val levels: FloatArray,
        val actualStartS: Double
    )

    /**
     * Turns decoded PCM into speech-band loudness for the window [startUs, endUs), at the
     * source sample rate, using the dialogue (centre) channel of 5.1/7.1 and the average of
     * the channels otherwise. Holds no PCM. Shared by both decoders below.
     */
    private class WindowMeter(private val startUs: Long, private val endUs: Long) {
        private var meter: SubtitleAligner.SpeechMeter? = null
        private var meterRate = 0
        var actualStartUs: Long? = null
            private set
        /** The window is covered, or the stream changed rate; stop decoding. */
        var done = false
            private set

        /** [data] holds interleaved PCM from its position to its limit, starting at [ptsUs]. */
        fun add(ptsUs: Long, data: java.nio.ByteBuffer, channels: Int, rate: Int, isFloat: Boolean) {
            if (done || channels <= 0 || rate <= 0) return
            data.order(ByteOrder.LITTLE_ENDIAN)
            val frames = data.remaining() / (channels * if (isFloat) 4 else 2)
            val durUs = frames * 1_000_000L / rate
            if (ptsUs >= endUs) { done = true; return }
            if (ptsUs + durUs <= startUs) return
            val first = if (ptsUs < startUs) ((startUs - ptsUs) * rate / 1_000_000L).toInt().coerceIn(0, frames) else 0
            val last = if (ptsUs + durUs > endUs) ((endUs - ptsUs) * rate / 1_000_000L).toInt().coerceIn(first, frames) else frames
            if (last <= first) return

            // A meter is built for one rate; a later change would mis-time it, so it ends the window.
            val m = meter ?: SubtitleAligner.SpeechMeter(rate).also { meter = it; meterRate = rate }
            if (rate != meterRate) { done = true; return }
            if (actualStartUs == null) actualStartUs = ptsUs + first * 1_000_000L / rate

            val centre = channels == 6 || channels == 8
            if (isFloat) {
                val buf = data.asFloatBuffer()
                for (f in first until last) {
                    val base = f * channels
                    val s = if (centre) buf.get(base + 2).toDouble() else {
                        var sum = 0.0
                        for (c in 0 until channels) sum += buf.get(base + c)
                        sum / channels
                    }
                    m.add(s.coerceIn(-1.0, 1.0))
                }
            } else {
                val buf = data.asShortBuffer()
                for (f in first until last) {
                    val base = f * channels
                    val s = if (centre) buf.get(base + 2) / 32768.0 else {
                        var sum = 0.0
                        for (c in 0 until channels) sum += buf.get(base + c)
                        sum / channels / 32768.0
                    }
                    m.add(s)
                }
            }
            if (last < frames || ptsUs + durUs >= endUs) done = true
        }

        fun result(fallbackStartS: Double): DecodedLevels? {
            val levels = meter?.levels()?.takeIf { it.isNotEmpty() } ?: return null
            return DecodedLevels(levels, (actualStartUs?.let { it / 1_000_000.0 }) ?: fallbackStartS)
        }
    }

    /**
     * Decodes up to [durationS] of audio from [windowStartS] and measures its speech-band
     * loudness. Platform decoders first; failing that, the Media3 FFmpeg extension the player
     * already ships, for the AC-3, E-AC-3, DTS and TrueHD soundtracks most phones cannot
     * decode -- often a film's only audio, and what ffmpeg-kit used to cover here.
     */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun decodeAudioWindow(videoPath: String, windowStartS: Double, durationS: Double = 300.0): DecodedLevels? {
        val context = reactApplicationContext
        val uri = Uri.parse(videoPath)
        var pfd: ParcelFileDescriptor? = null
        val extractor = MediaExtractor()
        try {
            if (videoPath.startsWith("content://")) {
                pfd = context.contentResolver.openFileDescriptor(uri, "r")
                if (pfd != null) extractor.setDataSource(pfd.fileDescriptor) else extractor.setDataSource(context, uri, null)
            } else {
                val cleanPath = if (videoPath.startsWith("file://")) uri.path ?: videoPath.removePrefix("file://") else videoPath
                extractor.setDataSource(cleanPath)
            }

            val codecs = MediaCodecList(MediaCodecList.REGULAR_CODECS)
            val ffmpeg = try { androidx.media3.decoder.ffmpeg.FfmpegLibrary.isAvailable() } catch (_: Throwable) { false }
            var platformTrack = -1
            var ffmpegTrack = -1
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                if (!mime.startsWith("audio/")) continue
                val platform = try { codecs.findDecoderForFormat(format) != null } catch (_: Exception) { false }
                if (platform && platformTrack < 0) platformTrack = i
                if (!platform && ffmpegTrack < 0 && ffmpeg &&
                    androidx.media3.decoder.ffmpeg.FfmpegLibrary.supportsFormat(mime)) ffmpegTrack = i
            }

            val startUs = (windowStartS * 1_000_000).toLong().coerceAtLeast(0L)
            val window = WindowMeter(startUs, startUs + (durationS * 1_000_000).toLong())
            val track = if (platformTrack >= 0) platformTrack else ffmpegTrack
            if (track < 0) {
                android.util.Log.w(NAME, "auto-sync: no decodable audio track")
                return null
            }
            val format = extractor.getTrackFormat(track)
            extractor.selectTrack(track)
            extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            if (track == platformTrack) decodeWithMediaCodec(extractor, format, codecs, window)
            else decodeWithFfmpeg(extractor, format, window)

            val result = window.result(windowStartS)
            android.util.Log.i(
                NAME, "auto-sync: ${format.getString(MediaFormat.KEY_MIME)} via " +
                    "${if (track == platformTrack) "platform" else "ffmpeg"} decoded " +
                    "${"%.1f".format(Locale.US, (result?.levels?.size ?: 0) * SubtitleAligner.FRAME_S)} s"
            )
            return result
        } finally {
            try { extractor.release() } catch (_: Exception) {}
            try { pfd?.close() } catch (_: Exception) {}
        }
    }

    private fun decodeWithMediaCodec(extractor: MediaExtractor, format: MediaFormat, codecs: MediaCodecList, window: WindowMeter) {
        val codec = MediaCodec.createByCodecName(codecs.findDecoderForFormat(format))
        try {
            codec.configure(format, null, null, 0)
            codec.start()
            var rate = format.getIntegerOr(MediaFormat.KEY_SAMPLE_RATE, 44100)
            var channels = format.getIntegerOr(MediaFormat.KEY_CHANNEL_COUNT, 2)
            var encoding = format.getIntegerOr(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var idle = 0
            while (!window.done && idle < 400) {
                if (!inputDone) {
                    val inIndex = codec.dequeueInputBuffer(5_000)
                    if (inIndex >= 0) {
                        val size = extractor.readSampleData(codec.getInputBuffer(inIndex)!!, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outIndex = codec.dequeueOutputBuffer(info, 5_000)
                when {
                    outIndex >= 0 -> {
                        idle = 0
                        val out = codec.getOutputBuffer(outIndex)
                        if (out != null && info.size > 0) {
                            out.position(info.offset)
                            out.limit(info.offset + info.size)
                            window.add(info.presentationTimeUs, out.slice(), channels, rate, encoding == AudioFormat.ENCODING_PCM_FLOAT)
                        }
                        codec.releaseOutputBuffer(outIndex, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    }
                    outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        idle = 0
                        val f = codec.outputFormat
                        rate = f.getIntegerOr(MediaFormat.KEY_SAMPLE_RATE, rate)
                        channels = f.getIntegerOr(MediaFormat.KEY_CHANNEL_COUNT, channels)
                        encoding = f.getIntegerOr(MediaFormat.KEY_PCM_ENCODING, encoding)
                    }
                    else -> idle++
                }
            }
        } finally {
            try { codec.stop() } catch (_: Exception) {}
            try { codec.release() } catch (_: Exception) {}
        }
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun decodeWithFfmpeg(extractor: MediaExtractor, format: MediaFormat, window: WindowMeter) {
        val mime = format.getString(MediaFormat.KEY_MIME)!!
        val init = ArrayList<ByteArray>()
        for (key in arrayOf("csd-0", "csd-1", "csd-2")) {
            format.getByteBuffer(key)?.let { b -> ByteArray(b.remaining()).also { b.duplicate().get(it) }.let(init::add) }
        }
        val media3Format = androidx.media3.common.Format.Builder()
            .setSampleMimeType(mime)
            .setChannelCount(format.getIntegerOr(MediaFormat.KEY_CHANNEL_COUNT, 2))
            .setSampleRate(format.getIntegerOr(MediaFormat.KEY_SAMPLE_RATE, 48000))
            .setInitializationData(init)
            .build()
        val maxInput = format.getIntegerOr(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
        val decoder = androidx.media3.decoder.ffmpeg.FfmpegAudioDecoder(media3Format, 16, 16, maxInput, /* outputFloat = */ false)
        try {
            var inputDone = false
            var idle = 0
            while (!window.done && idle < 400) {
                var progressed = false
                if (!inputDone) {
                    val input = decoder.dequeueInputBuffer()
                    if (input != null) {
                        val sampleSize = extractor.sampleSize
                        if (sampleSize < 0) {
                            input.addFlag(androidx.media3.common.C.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            input.ensureSpaceForWrite(sampleSize.toInt())
                            val data = input.data!!
                            val size = extractor.readSampleData(data, data.position())
                            data.position(data.position() + size.coerceAtLeast(0))
                            input.timeUs = extractor.sampleTime
                            extractor.advance()
                        }
                        input.flip()
                        decoder.queueInputBuffer(input)
                        progressed = true
                    }
                }
                val output = decoder.dequeueOutputBuffer()
                if (output != null) {
                    progressed = true
                    if (output.isEndOfStream) {
                        output.release()
                        return
                    }
                    output.data?.let { window.add(output.timeUs, it, decoder.channelCount, decoder.sampleRate, false) }
                    output.release()
                }
                if (progressed) idle = 0 else { idle++; Thread.sleep(5) }
            }
        } finally {
            decoder.release()
        }
    }

    private fun MediaFormat.getIntegerOr(key: String, fallback: Int) =
        if (containsKey(key)) getInteger(key) else fallback

    /**
     * Decodes audio directly from [videoPath] using MediaExtractor and MediaCodec, and aligns
     * cue times against the extracted speech band.
     */
    @ReactMethod
    fun alignVideo(videoPath: String, windowStartS: Double, starts: ReadableArray, ends: ReadableArray, promise: Promise) {
        thread(name = "subtitle-align-video") {
            try {
                val decoded = decodeAudioWindow(videoPath, windowStartS, 300.0)
                    ?: return@thread promise.reject("E_NO_AUDIO", "No decodable audio in this video")

                val s = DoubleArray(starts.size()) { starts.getDouble(it) }
                val e = DoubleArray(ends.size()) { ends.getDouble(it) }

                val result = SubtitleAligner.align(decoded.levels, decoded.actualStartS, s, e)
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
     * Embedded subtitle tracks, in the player's own ordinal order (same Media3 extractor), with
     * the container's default and forced flags. Reads only the file header.
     */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    @ReactMethod
    fun getSubtitleTracks(videoPath: String, promise: Promise) {
        thread(name = "subtitle-tracks") {
            try {
                val uri = EmbeddedSubtitles.toUri(videoPath)
                val tracks = Arguments.createArray()
                if (!EmbeddedSubtitles.isNetwork(uri)) {
                    for (t in EmbeddedSubtitles.listTracks(reactApplicationContext, uri)) {
                        val lang = t.language
                        tracks.pushMap(Arguments.createMap().apply {
                            putInt("index", t.ordinal)
                            putString("codec", t.codec)
                            putString("language", lang)
                            putString("title", t.label ?: if (lang != "und") lang else "Subtitle ${t.ordinal + 1}")
                            putBoolean("isDefault", t.isDefault)
                            putBoolean("isForced", t.isForced)
                            putBoolean("isBitmap", t.isBitmap)
                        })
                    }
                }
                promise.resolve(tracks)
            } catch (t: Throwable) {
                promise.resolve(Arguments.createArray())
            }
        }
    }

    /**
     * Writes embedded text subtitle track [ordinal] to an SRT file in the cache and resolves
     * its path, or null when the track has no text cues (bitmap, unsupported, empty) or the
     * video is a network stream (this reads the whole file). Replaces ffmpeg-kit's extraction;
     * the file name matches what SubtitleExtractor.cleanupSubtitleFiles sweeps.
     */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    @ReactMethod
    fun extractSubtitle(videoPath: String, ordinal: Int, promise: Promise) {
        thread(name = "subtitle-extract") {
            try {
                val uri = EmbeddedSubtitles.toUri(videoPath)
                val srt = if (EmbeddedSubtitles.isNetwork(uri)) null
                    else EmbeddedSubtitles.extractSrt(reactApplicationContext, uri, ordinal)
                if (srt == null) {
                    promise.resolve(null)
                    return@thread
                }
                val file = File(reactApplicationContext.cacheDir, "subtitle_${System.nanoTime()}.srt")
                file.writeText(srt)
                promise.resolve(file.absolutePath)
            } catch (t: Throwable) {
                promise.reject("E_EXTRACT_SUBTITLE", t.message ?: "Subtitle extraction failed", t)
            }
        }
    }

}
