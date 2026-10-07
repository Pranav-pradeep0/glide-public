package com.glide.app.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

/**
 * Shifts audio against video by [delayMs]; positive plays the audio later.
 *
 * The audio sink drives the playback clock from the frames it has played, so inserting
 * silence holds the clock back and video waits for it, and dropping frames runs it ahead.
 * Either way the offset is between the two streams, which is all audio delay is.
 *
 * A flush (seek, new format) restarts the sink's clock, so the whole delay is applied again
 * from there. A change mid-playback applies only the difference.
 *
 * ponytail: the reported position carries the delay too (a +200 ms delay reads 200 ms
 * ahead). Invisible at sync-sized values; subtract it in the progress event if it ever matters.
 */
@UnstableApi
class AudioDelayProcessor : BaseAudioProcessor() {

    /** Set from the main thread, read on the playback thread. */
    @Volatile var delayMs = 0

    /** Delay already baked into the output since the last flush. */
    private var appliedMs = 0
    private var pendingDropFrames = 0L

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        // Unsigned 8-bit is the one PCM whose silence is not zero bytes. Nothing we decode
        // produces it; stand aside rather than fail playback over it.
        if (inputAudioFormat.encoding == C.ENCODING_PCM_8BIT || inputAudioFormat.bytesPerFrame <= 0) {
            return AudioProcessor.AudioFormat.NOT_SET
        }
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val bytesPerFrame = inputAudioFormat.bytesPerFrame
        val target = delayMs
        var silenceFrames = 0L
        if (target != appliedMs) {
            val frames = (target - appliedMs).toLong() * inputAudioFormat.sampleRate / 1000
            appliedMs = target
            if (frames < 0) {
                pendingDropFrames -= frames
            } else {
                // Undo a drop that has not happened yet before adding silence.
                val cancelled = minOf(frames, pendingDropFrames)
                pendingDropFrames -= cancelled
                silenceFrames = frames - cancelled
            }
        }

        if (pendingDropFrames > 0) {
            val drop = minOf(pendingDropFrames, (inputBuffer.remaining() / bytesPerFrame).toLong())
            pendingDropFrames -= drop
            inputBuffer.position(inputBuffer.position() + (drop * bytesPerFrame).toInt())
        }

        val silenceBytes = (silenceFrames * bytesPerFrame).toInt()
        val remaining = inputBuffer.remaining()
        if (silenceBytes == 0 && remaining == 0) return
        val output = replaceOutputBuffer(silenceBytes + remaining)
        repeat(silenceBytes) { output.put(0) }
        output.put(inputBuffer)
        output.flip()
    }

    override fun onFlush() {
        appliedMs = 0
        pendingDropFrames = 0
    }

    override fun onReset() {
        onFlush()
    }
}
