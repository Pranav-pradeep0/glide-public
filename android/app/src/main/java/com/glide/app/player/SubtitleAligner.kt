package com.glide.app.player

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Automatic subtitle sync by aligning *when people speak* with *when cues are shown* -- the
 * ffsubsync / alass idea, with no speech recognition, no network and no language dependence.
 *
 * 1. [speechLevels]: the audio, band-passed to the speech band (300-3000 Hz), as loudness in
 *    dB every 10 ms.
 * 2. [align]: slide the cue intervals across that loudness, +/-[MAX_SHIFT_S]. At each lag the
 *    score is mean loudness inside cues minus mean loudness outside them, which prefix sums
 *    make O(cues) per lag instead of O(frames). The best lag is the delay.
 * 3. The same search at the common frame-rate ratios ([RATIOS]) catches subtitles timed for a
 *    different frame rate, whose error grows through the film and no constant delay can fix.
 *
 * Pure arithmetic, so [SubtitleAlignerTest] runs it on the JVM. The bridge is
 * [SubtitleSyncModule].
 */
internal object SubtitleAligner {

    const val FRAME_S = 0.01
    const val MAX_SHIFT_S = 60.0

    /** Subtitle timed at one rate, video at another: cue times scale by these. */
    val RATIOS = doubleArrayOf(1.0, 25 / 23.976, 23.976 / 25, 25.0 / 24, 24.0 / 25, 24 / 23.976, 23.976 / 24)

    /**
     * Apply only when the peak stands this many robust sigmas above the typical lag, and no
     * other lag (further than [RUNNER_UP_GUARD_S] away) comes within [MAX_RUNNER_UP] of it.
     * Both guard against confidently applying a wrong delay, which is worse than none.
     */
    const val MIN_PEAK_Z = 6.0
    const val MAX_RUNNER_UP = 0.75
    const val RUNNER_UP_GUARD_S = 1.0

    /** Minimum speech-cue time that must overlap the audio, or the score means nothing. */
    const val MIN_CUE_SECONDS = 20.0

    data class Result(
        /** Positive = show subtitles later, the app's `subtitleDelay` convention. */
        val delayS: Double,
        val ratio: Double,
        val peakZ: Double,
        val runnerUp: Double,
    ) {
        val confident get() = peakZ >= MIN_PEAK_Z && runnerUp <= MAX_RUNNER_UP
        /** The best fit needs a frame-rate change, which a delay alone cannot apply. */
        val drift get() = confident && ratio != 1.0
    }

    /** 16-bit mono PCM to speech-band loudness in dB, one value per [FRAME_S]. */
    fun speechLevels(pcm: ShortArray, sampleRate: Int): FloatArray {
        val hp = Biquad(sampleRate, 300.0, highPass = true)
        val lp = Biquad(sampleRate, 3000.0, highPass = false)
        val frame = (sampleRate * FRAME_S).roundToInt()
        return FloatArray(pcm.size / frame) { f ->
            var energy = 0.0
            for (i in f * frame until (f + 1) * frame) {
                val x = lp.process(hp.process(pcm[i] / 32768.0))
                energy += x * x
            }
            (10 * log10(energy / frame + 1e-10)).toFloat()
        }
    }

    /**
     * Where the cues ([starts]/[ends], seconds of video time) best line up with [levels], whose
     * first frame is at [windowStartS]. Null if too little cue time overlaps the audio.
     */
    fun align(levels: FloatArray, windowStartS: Double, starts: DoubleArray, ends: DoubleArray): Result? {
        val n = levels.size
        if (n < 2 * (MAX_SHIFT_S / FRAME_S)) return null
        // Loudness, floored so digital silence does not dominate, then standardised.
        val a = DoubleArray(n) { levels[it].coerceIn(-80f, 0f).toDouble() }
        val mean = a.average()
        val sd = sqrt(a.sumOf { (it - mean) * (it - mean) } / n)
        if (sd < 1e-6) return null
        val prefix = DoubleArray(n + 1)
        for (i in 0 until n) prefix[i + 1] = prefix[i] + (a[i] - mean) / sd

        // A plain delay wins whenever it fits. 24/23.976 is only 0.1% from 1, so inside one window
        // it scores about the same as a delay, and letting the higher z win would randomly call
        // an in-sync subtitle "drifting". Other ratios are only for when no delay fits at all.
        val plain = alignAt(prefix, n, windowStartS, starts, ends, 1.0)
        if (plain?.confident == true) return plain
        return (listOfNotNull(plain) + RATIOS.drop(1).mapNotNull { alignAt(prefix, n, windowStartS, starts, ends, it) })
            .maxByOrNull { it.peakZ }
    }

    private fun alignAt(
        prefix: DoubleArray, n: Int, windowStartS: Double,
        starts: DoubleArray, ends: DoubleArray, ratio: Double,
    ): Result? {
        val maxLag = (MAX_SHIFT_S / FRAME_S).roundToInt()
        // Cue intervals in audio frames at lag 0, merged, keeping only those that can reach the
        // window at some lag.
        val intervals = starts.indices
            .map { (starts[it] * ratio - windowStartS) / FRAME_S to (ends[it] * ratio - windowStartS) / FRAME_S }
            .filter { (s, e) -> e > s && e > -maxLag && s < n + maxLag }
            .sortedBy { it.first }
            .fold(mutableListOf<Pair<Double, Double>>()) { merged, iv ->
                val last = merged.lastOrNull()
                if (last != null && iv.first <= last.second) merged[merged.size - 1] = last.first to maxOf(last.second, iv.second)
                else merged += iv
                merged
            }
        if (intervals.isEmpty()) return null
        val minIn = (MIN_CUE_SECONDS / FRAME_S).roundToInt()
        val total = prefix[n]

        val scores = DoubleArray(2 * maxLag + 1) { idx ->
            val lag = idx - maxLag
            var sumIn = 0.0
            var nIn = 0
            for ((s, e) in intervals) {
                val lo = (s + lag).roundToInt().coerceIn(0, n)
                val hi = (e + lag).roundToInt().coerceIn(0, n)
                if (hi > lo) { sumIn += prefix[hi] - prefix[lo]; nIn += hi - lo }
            }
            if (nIn < minIn || n - nIn < minIn) Double.NaN
            else sumIn / nIn - (total - sumIn) / (n - nIn)
        }

        val finite = scores.filter { !it.isNaN() }.sorted()
        if (finite.size < scores.size / 2) return null
        val median = finite[finite.size / 2]
        val mad = finite.map { abs(it - median) }.sorted()[finite.size / 2]
        val sigma = 1.4826 * mad
        val peak = scores.indices.filter { !scores[it].isNaN() }.maxByOrNull { scores[it] } ?: return null
        val guard = (RUNNER_UP_GUARD_S / FRAME_S).roundToInt()
        val runner = scores.indices
            .filter { abs(it - peak) > guard && !scores[it].isNaN() }
            .maxOfOrNull { scores[it] } ?: median
        val height = scores[peak] - median
        if (sigma <= 0 || height <= 0) return null

        // Sub-frame peak by parabola through the three samples around it.
        val left = scores.getOrNull(peak - 1)?.takeUnless { it.isNaN() } ?: scores[peak]
        val right = scores.getOrNull(peak + 1)?.takeUnless { it.isNaN() } ?: scores[peak]
        val curvature = left - 2 * scores[peak] + right
        val fraction = if (curvature < 0) (0.5 * (left - right) / curvature).coerceIn(-0.5, 0.5) else 0.0

        return Result(
            delayS = (peak - maxLag + fraction) * FRAME_S,
            ratio = ratio,
            peakZ = height / sigma,
            runnerUp = (runner - median) / height,
        )
    }

    /** Interleaved 16-bit PCM. */
    class Wav(val samples: ShortArray, val channels: Int, val sampleRate: Int) {
        fun channel(c: Int) = ShortArray(samples.size / channels) { samples[it * channels + c] }

        /**
         * Where the dialogue is: the centre channel of 5.1/7.1 (FFmpeg orders FL FR FC ...), the
         * mid of stereo, or the only channel.
         */
        fun dialogue(): ShortArray = when {
            channels >= 3 -> channel(2)
            channels == 2 -> ShortArray(samples.size / 2) { ((samples[2 * it] + samples[2 * it + 1]) / 2).toShort() }
            else -> samples
        }
    }

    /** 16-bit PCM from a WAV file's bytes, any channel count, or null if it is not one. */
    fun pcmFromWav(bytes: ByteArray): Wav? {
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        if (bytes.size < 12 || String(bytes, 0, 4) != "RIFF" || String(bytes, 8, 4) != "WAVE") return null
        var pos = 12
        var rate = 0
        var channels = 0
        var ok = false
        while (pos + 8 <= bytes.size) {
            val id = String(bytes, pos, 4)
            val size = buf.getInt(pos + 4)
            val body = pos + 8
            if (id == "fmt ") {
                channels = buf.getShort(body + 2).toInt()
                rate = buf.getInt(body + 4)
                val bits = buf.getShort(body + 14).toInt()
                ok = channels in 1..8 && bits == 16
            } else if (id == "data") {
                if (!ok || rate <= 0) return null
                val count = minOf(size, bytes.size - body) / 2 / channels * channels
                return Wav(ShortArray(count) { buf.getShort(body + 2 * it) }, channels, rate)
            }
            pos = body + size + (size and 1)
        }
        return null
    }

    /** RBJ cookbook second-order filter, Q = 1/sqrt(2). */
    private class Biquad(sampleRate: Int, cutoff: Double, highPass: Boolean) {
        private val b0: Double
        private val b1: Double
        private val b2: Double
        private val a1: Double
        private val a2: Double
        private var x1 = 0.0
        private var x2 = 0.0
        private var y1 = 0.0
        private var y2 = 0.0

        init {
            val w = 2 * PI * cutoff / sampleRate
            val alpha = sin(w) / (2 * 0.7071067811865476)
            val c = cos(w)
            val a0 = 1 + alpha
            val k = if (highPass) (1 + c) / 2 else (1 - c) / 2
            b0 = k / a0
            b1 = (if (highPass) -(1 + c) else 1 - c) / a0
            b2 = k / a0
            a1 = -2 * c / a0
            a2 = (1 - alpha) / a0
        }

        fun process(x: Double): Double {
            val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            return y
        }
    }
}
