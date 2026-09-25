package com.glide.app.player

import com.glide.app.player.SubtitleAligner.FRAME_S
import com.glide.app.player.SubtitleAligner.align
import com.glide.app.player.SubtitleAligner.pcmFromWav
import com.glide.app.player.SubtitleAligner.speechLevels
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/**
 * Synthetic but adversarial: speech at cue times shifted by a known delay, noise throughout,
 * and loud non-speech bursts ("music") in a third of the gaps, which no delay explains.
 * A wrong delay applied confidently is worse than none, so the refusals are tested as hard as
 * the successes.
 */
class SubtitleAlignerTest {

    private val windowStart = 1500.0
    private val windowLength = 300.0

    /** Cues across the whole film, realistic lengths and gaps. */
    private fun cues(seed: Int = 1): Pair<DoubleArray, DoubleArray> {
        val rnd = Random(seed)
        val s = mutableListOf<Double>()
        val e = mutableListOf<Double>()
        var t = 5.0
        while (t < 3600) {
            val len = 1.0 + rnd.nextDouble() * 3.0
            s += t; e += t + len
            t += len + 0.5 + rnd.nextDouble() * 3.0
        }
        return s.toDoubleArray() to e.toDoubleArray()
    }

    /** Loudness where speech happens at [speechTime] of each cue interval. */
    private fun levels(
        starts: DoubleArray, ends: DoubleArray, speechTime: (Double) -> Double, seed: Int = 7,
    ): FloatArray {
        val rnd = Random(seed)
        val n = (windowLength / FRAME_S).roundToInt()
        val out = FloatArray(n) { -48f + rnd.nextFloat() * 8f }
        for (i in starts.indices) {
            val a = ((speechTime(starts[i]) - windowStart) / FRAME_S).roundToInt()
            val b = ((speechTime(ends[i]) - windowStart) / FRAME_S).roundToInt()
            for (f in a.coerceAtLeast(0) until b.coerceAtMost(n)) out[f] = -22f + rnd.nextFloat() * 10f
            // Music in some gaps: as loud as speech, and tied to no cue.
            if (i + 1 < starts.size && rnd.nextInt(3) == 0) {
                val g0 = ((speechTime(ends[i]) - windowStart) / FRAME_S).roundToInt()
                val g1 = ((speechTime(starts[i + 1]) - windowStart) / FRAME_S).roundToInt()
                for (f in g0.coerceAtLeast(0) until g1.coerceAtMost(n)) out[f] = -24f + rnd.nextFloat() * 10f
            }
        }
        return out
    }

    @Test
    fun `recovers the delay in both directions to within a frame or two`() {
        val (s, e) = cues()
        listOf(0.0, 2.37, -7.81, 41.5).forEach { delay ->
            val r = align(levels(s, e, { it + delay }), windowStart, s, e)
            assertNotNull(r)
            assertEquals("delay $delay", delay, r!!.delayS, 0.02)
            assertTrue("delay $delay should be confident: z=${r.peakZ} runner=${r.runnerUp}", r.confident)
            assertEquals(1.0, r.ratio, 0.0)
        }
    }

    @Test
    fun `positive delay means show subtitles later`() {
        // Speech 3 s after the cues say: the app must delay subtitles by +3 s, the same sign
        // as SubtitleSyncService.calculateOffset and the player's effectiveTime = t - delay.
        val (s, e) = cues()
        val r = align(levels(s, e, { it + 3.0 }), windowStart, s, e)!!
        assertTrue(r.delayS > 2.9)
    }

    @Test
    fun `audio unrelated to the cues is refused, not guessed`() {
        val (s, e) = cues(seed = 1)
        val (s2, e2) = cues(seed = 99)   // a different film's dialogue pattern
        val r = align(levels(s2, e2, { it }), windowStart, s, e)
        assertFalse("must not be confident on unrelated audio: $r", r?.confident ?: false)
    }

    @Test
    fun `subtitles timed for another frame rate are reported as drift`() {
        // PAL-speed subtitle on a 23.976 film: 30 minutes in, the error is ~77 s -- beyond any
        // delay search, and no constant delay could fix the whole film anyway.
        val (s, e) = cues()
        val ratio = 25 / 23.976
        val r = align(levels(s, e, { it * ratio }), windowStart, s, e)!!
        assertTrue("expected drift, got $r", r.drift)
        assertEquals(ratio, r.ratio, 1e-9)
    }

    @Test
    fun `an in-sync subtitle is never called drift`() {
        // 24/23.976 is 0.1% from 1 and scores almost the same inside one window.
        val (s, e) = cues()
        val r = align(levels(s, e, { it }), windowStart, s, e)!!
        assertFalse(r.drift)
        assertEquals(1.0, r.ratio, 0.0)
    }

    @Test
    fun `too little audio or cue overlap is refused`() {
        val (s, e) = cues()
        assertNull(align(FloatArray(1000) { -30f }, windowStart, s, e))
        assertNull("no cues near the window", align(levels(s, e, { it }), 10_000.0, s, e))
    }

    @Test
    fun `speech band keeps voice frequencies and drops hum`() {
        val rate = 16000
        fun tone(hz: Double) = ShortArray(rate) { (8000 * sin(2 * PI * hz * it / rate)).toInt().toShort() }
        val voice = speechLevels(tone(1000.0), rate).drop(20).average()
        val hum = speechLevels(tone(50.0), rate).drop(20).average()
        val silence = speechLevels(ShortArray(rate), rate).average()
        assertEquals(100, speechLevels(tone(1000.0), rate).size)
        // Amplitude 8000/32768 is -15.26 dB RMS for a sine; the pass band must keep it within 0.5 dB.
        assertEquals("1 kHz should pass untouched", -15.26, voice, 0.5)
        assertTrue("50 Hz hum should be cut by >25 dB: voice $voice, hum $hum", voice - hum > 25)
        assertTrue(silence < -90)
    }

    @Test
    fun `reads ffmpeg WAVs, including a LIST chunk before the data`() {
        fun wav(channels: Int): ByteArray {
            val list = "INFOISFT\u0004\u0000\u0000\u0000Lavf".toByteArray(Charsets.ISO_8859_1)
            val data = ShortArray(4) { (it * 100).toShort() }
            return ByteBuffer.allocate(12 + 24 + 8 + list.size + 8 + data.size * 2).order(ByteOrder.LITTLE_ENDIAN).apply {
                put("RIFF".toByteArray()); putInt(0); put("WAVE".toByteArray())
                put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(channels.toShort())
                putInt(16000); putInt(32000 * channels); putShort((2 * channels).toShort()); putShort(16)
                put("LIST".toByteArray()); putInt(list.size); put(list)
                put("data".toByteArray()); putInt(data.size * 2); data.forEach { putShort(it) }
            }.array()
        }
        val (pcm, rate) = pcmFromWav(wav(1))!!
        assertEquals(16000, rate)
        assertEquals(listOf<Short>(0, 100, 200, 300), pcm.toList())
        assertNull("stereo is not what the extractor produces", pcmFromWav(wav(2)))
    }
}
