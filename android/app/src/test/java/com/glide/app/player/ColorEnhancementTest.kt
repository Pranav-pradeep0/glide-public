package com.glide.app.player

import com.glide.app.player.ColorEnhancement.HDR_WORKING_NITS
import com.glide.app.player.ColorEnhancement.MID_GREY_FRACTION
import com.glide.app.player.ColorEnhancement.SATURATION_HDR
import com.glide.app.player.ColorEnhancement.apply
import com.glide.app.player.ColorEnhancement.hdr
import com.glide.app.player.ColorEnhancement.sdrMatrix
import com.glide.app.player.ColorEnhancement.toIctcp
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot

/**
 * The enhancement is pure arithmetic over linear light, and its serious defects have all been
 * arithmetic: a contrast pivot that crushed HDR midtones, then a matrix offset that erased
 * HDR shadows. None of this needs a device.
 *
 * Shadow checks are **relative**. An absolute nit tolerance hides a 100% loss at 0.01 nits.
 */
class ColorEnhancementTest {

    private val sdr = sdrMatrix()

    /** A neutral HDR pixel at [nits], through the enhancement, back in nits. */
    private fun hdrNits(nits: Float): Float {
        val v = nits / HDR_WORKING_NITS
        return hdr(v, v, v)[1] * HDR_WORKING_NITS
    }

    @Test
    fun `SDR matrix is exactly what users signed off`() {
        // HDR work must not move SDR. These are the values the confirmed build shipped.
        assertArrayEquals(
            floatArrayOf(
                1.221653f, -0.04094675f, -0.04094675f, 0f,
                -0.1377475f, 1.124853f, -0.1377475f, 0f,
                -0.01390572f, -0.01390572f, 1.248694f, 0f,
                -0.01260001f, -0.01260001f, -0.01260001f, 1f,
            ),
            sdr,
            1e-6f,
        )
    }

    @Test
    fun `SDR contrast pivots exactly on mid-grey`() {
        val p = MID_GREY_FRACTION
        val (r, g, b) = apply(sdr, p, p, p)
        listOf(r, g, b).forEach { assertEquals(p.toDouble(), it.toDouble(), p * 1e-4) }
    }

    @Test
    fun `SDR saturation leaves neutral grey neutral`() {
        val (r, g, b) = apply(sdr, 0.5f, 0.5f, 0.5f)
        assertEquals(r.toDouble(), g.toDouble(), 1e-6)
        assertEquals(g.toDouble(), b.toDouble(), 1e-6)
    }

    @Test
    fun `SDR saturation actually increases colour separation`() {
        val (r, g, _) = apply(sdr, 0.5f, 0.2f, 0.2f)
        assertTrue("expected red to pull away from green", (r - g) > (0.5f - 0.2f))
    }

    @Test
    fun `HDR round trip is exact with the enhancement at zero`() {
        // Pins the BT.2100 matrices, their inverses, the PQ pair and the working scale in one
        // go: any of them wrong and a do-nothing enhancement stops doing nothing.
        val pixels = listOf(0.005f, 0.1f, 1f, 36.5f, 203f, 1000f, 4000f)
            .map { floatArrayOf(it, it, it) } +
            listOf(floatArrayOf(120f, 40f, 15f), floatArrayOf(0.2f, 0.5f, 0.1f))
        pixels.forEach { nits ->
            val v = FloatArray(3) { nits[it] / HDR_WORKING_NITS }
            val out = hdr(v[0], v[1], v[2], lift = 0f, saturation = 1f)
            for (c in 0..2) {
                assertEquals("channel $c of ${nits.toList()}", v[c].toDouble(), out[c].toDouble(), v[c] * 1e-3)
            }
        }
    }

    @Test
    fun `HDR near-black is preserved within a few percent`() {
        // The defect this path exists to fix. The matrix it replaced took 0.01 nits to 0.0046
        // (-54%) and everything under 0.006 nits to pure black.
        listOf(0.01f, 0.02f, 0.05f, 0.1f, 0.2f, 0.5f).forEach { nits ->
            val change = hdrNits(nits) / nits - 1f
            assertTrue("$nits nits changed by ${change * 100}%", abs(change) <= 0.03f)
        }
    }

    @Test
    fun `HDR black stays black`() {
        val out = hdr(0f, 0f, 0f)
        out.forEach { assertEquals(0.0, it.toDouble(), 1e-9) }
    }

    @Test
    fun `HDR never darkens a neutral pixel up to the mastering peak`() {
        // Enhancement may brighten and may leave alone. Nothing in 0.001-1000 nits may lose
        // light -- that is the "never subtracts a constant" guarantee, checked relatively.
        var nits = 0.001f
        while (nits <= 1000f) {
            val out = hdrNits(nits)
            assertTrue("$nits nits darkened to $out", out >= nits * (1f - 1e-4f))
            nits *= 1.5f
        }
    }

    @Test
    fun `HDR midtones still get real lift`() {
        // The punch users liked from the matrix, which lifted this range by ~6%.
        listOf(3f, 9f, 27f, 81f, 203f).forEach { nits ->
            val gain = hdrNits(nits) / nits - 1f
            assertTrue("$nits nits should lift by >=3%, got ${gain * 100}%", gain >= 0.03f)
        }
    }

    @Test
    fun `HDR highlights roll off instead of passing the mastering peak`() {
        // The matrix pushed 1000 nits to 1060, past what the content was graded to.
        assertEquals(1000.0, hdrNits(1000f).toDouble(), 1000 * 1e-3)
        assertTrue("4000 nits should compress", hdrNits(4000f) < 4000f)

        // And the curve never folds back on itself: brighter in, brighter out.
        var previous = 0f
        var nits = 0.001f
        while (nits <= 10000f) {
            val out = hdrNits(nits)
            assertTrue("not monotonic at $nits nits", out > previous)
            previous = out
            nits *= 1.2f
        }
    }

    @Test
    fun `HDR saturation is the same at 3 nits and 1000, and keeps hue`() {
        // Scaling Ct/Cp is perceptually uniform; a linear-light saturation is not. Chroma must
        // grow by exactly SATURATION_HDR at both ends, with the hue angle untouched.
        listOf(3f, 1000f).forEach { nits ->
            val v = floatArrayOf(1.3f, 1f, 0.8f).map { it * nits / HDR_WORKING_NITS }
            val (_, ct, cp) = toIctcp(v[0], v[1], v[2])
            val (r, g, b) = hdr(v[0], v[1], v[2], lift = 0f)
            val (_, ct2, cp2) = toIctcp(r, g, b)
            assertEquals("chroma at $nits nits", SATURATION_HDR.toDouble(), hypot(ct2, cp2) / hypot(ct, cp).toDouble(), 1e-3)
            assertEquals("hue at $nits nits", atan2(cp, ct).toDouble(), atan2(cp2, ct2).toDouble(), 1e-3)
        }
    }
}
