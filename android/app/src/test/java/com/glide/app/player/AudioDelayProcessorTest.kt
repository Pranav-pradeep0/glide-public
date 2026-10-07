package com.glide.app.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import org.junit.Assert.assertArrayEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class AudioDelayProcessorTest {

    // 1 kHz mono 16-bit: one frame per millisecond, two bytes per frame.
    private fun processor(delayMs: Int) = AudioDelayProcessor().apply {
        this.delayMs = delayMs
        configure(AudioProcessor.AudioFormat(1000, 1, C.ENCODING_PCM_16BIT))
        flush()
    }

    private fun AudioDelayProcessor.feed(vararg samples: Short): ShortArray {
        val input = ByteBuffer.allocateDirect(samples.size * 2).order(ByteOrder.nativeOrder())
        samples.forEach { input.putShort(it) }
        input.flip()
        queueInput(input)
        val out = output.order(ByteOrder.nativeOrder()).asShortBuffer()
        return ShortArray(out.remaining()).also { out.get(it) }
    }

    @Test
    fun positiveDelayPrependsSilenceOnce() {
        val p = processor(3)
        assertArrayEquals(shortArrayOf(0, 0, 0, 1, 2), p.feed(1, 2))
        assertArrayEquals(shortArrayOf(3), p.feed(3))
    }

    @Test
    fun negativeDelayDropsAcrossBuffers() {
        val p = processor(-3)
        assertArrayEquals(shortArrayOf(), p.feed(1, 2))
        assertArrayEquals(shortArrayOf(4, 5), p.feed(3, 4, 5))
    }

    @Test
    fun flushReappliesTheWholeDelayAndChangesApplyTheDifference() {
        val p = processor(2)
        p.feed(1)
        p.flush()
        assertArrayEquals(shortArrayOf(0, 0, 7), p.feed(7))
        p.delayMs = 3
        assertArrayEquals(shortArrayOf(0, 8), p.feed(8))
    }
}
