package com.glide.app.player

import com.glide.app.player.ColorEnhancement.HLG_DIFFUSE_WHITE_LINEAR
import com.glide.app.player.ColorEnhancement.MID_GREY_FRACTION
import com.glide.app.player.ColorEnhancement.PQ_DIFFUSE_WHITE_LINEAR
import com.glide.app.player.ColorEnhancement.apply
import com.glide.app.player.ColorEnhancement.matrix
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.exp

/**
 * The enhancement matrix is pure arithmetic over linear light, and the one serious defect it
 * has had was arithmetic: a contrast pivot correct for SDR and ~50x wrong for PQ, which
 * crushed every HDR midtone to black. None of this needs a device.
 */
class ColorEnhancementTest {

    private val sdr = matrix(useHdr = false, isHlg = false)
    private val pq = matrix(useHdr = true, isHlg = false)
    private val hlg = matrix(useHdr = true, isHlg = true)

    /** Mid-grey for each space. SDR pivots here; HDR deliberately does not. */
    private val sdrGrey = MID_GREY_FRACTION
    private val pqGrey = MID_GREY_FRACTION * PQ_DIFFUSE_WHITE_LINEAR
    private val hlgGrey = MID_GREY_FRACTION * HLG_DIFFUSE_WHITE_LINEAR

    @Test
    fun `contrast pivots exactly on its stated pivot in every transfer function`() {
        // A neutral value at the pivot must come out unchanged: that is what "pivot" means.
        listOf(false to false, true to false, true to true).forEach { (useHdr, isHlg) ->
            val m = matrix(useHdr, isHlg)
            val p = ColorEnhancement.contrastPivot(useHdr, isHlg)
            val (r, g, b) = apply(m, p, p, p)
            assertEquals(p.toDouble(), r.toDouble(), p * 1e-4)
            assertEquals(p.toDouble(), g.toDouble(), p * 1e-4)
            assertEquals(p.toDouble(), b.toDouble(), p * 1e-4)
        }
    }

    @Test
    fun `HDR pivots on the shadow floor, not mid-grey`() {
        // The distinction the whole fix rests on. Pivoting HDR at mid-grey put a night
        // scene's lit areas below the pivot, so they were darkened along with its shadows.
        assertTrue(
            "HDR pivot must sit far below mid-grey",
            ColorEnhancement.contrastPivot(useHdr = true, isHlg = false) < pqGrey / 10f
        )
        assertEquals(
            "SDR must still pivot on mid-grey",
            sdrGrey.toDouble(),
            ColorEnhancement.contrastPivot(useHdr = false, isHlg = false).toDouble(),
            1e-6
        )
    }

    @Test
    fun `PQ midtones survive instead of clamping to black`() {
        // The regression. With the old 0.18 pivot the offset was -0.0063 while PQ mid-grey
        // is 0.00365, so this came out negative and clipped to pure black on screen.
        val (r, _, _) = apply(pq, pqGrey, pqGrey, pqGrey)
        assertTrue("PQ mid-grey must stay positive, was $r", r > 0f)
        assertEquals(36.54, (pqGrey * 10000f).toDouble(), 0.01)   // sanity: 36.5 nits
    }

    @Test
    fun `PQ diffuse white stays near 203 nits`() {
        // BT.2408 reference white. Contrast lifts it slightly; it must not be darkened, and
        // the old version pushed it down to ~147 nits.
        val white = PQ_DIFFUSE_WHITE_LINEAR
        val (r, _, _) = apply(pq, white, white, white)
        val nits = r * 10000f
        assertTrue("expected a slight lift above 203, got $nits", nits in 203.0..225.0)
    }

    @Test
    fun `nothing visible is crushed to black in PQ`() {
        // Whatever the offset costs, it must not eat real shadow detail. 5 nits is already
        // deep shadow; anything above it has to survive.
        val fiveNits = 5f / 10000f
        val (r, _, _) = apply(pq, fiveNits, fiveNits, fiveNits)
        assertTrue("5 nits must survive, got ${r * 10000f} nits", r > 0f)
    }

    @Test
    fun `HDR never perceptibly darkens a neutral pixel, at any luminance`() {
        // The dark-scene regression, and the reason the pivot moved. Contrast about a
        // 36.5-nit pivot subtracted 2.19 nits from every pixel: nothing at 203 nits, -67%
        // at 3 nits. A night scene lies entirely below that pivot, so its *lit* areas were
        // crushed along with its shadows.
        //
        // Enhancement may brighten and it may leave alone. Any darkening must stay under a
        // tenth of a nit, which is beneath any panel's black floor and cannot be seen.
        listOf(0.1f, 0.5f, 1f, 3f, 5f, 10f, 36.54f, 100f, 203f, 1000f, 4000f).forEach { nits ->
            val v = nits / 10000f
            val (r, _, _) = apply(pq, v, v, v)
            val out = r * 10000f
            assertTrue(
                "$nits nits darkened to $out — more than the 0.1 nit floor",
                out >= nits - 0.1f
            )
        }
    }

    @Test
    fun `HDR contrast still provides real lift through the diffuse range`() {
        // The other half of the report: removing the contrast entirely read as "even bad",
        // because the contrast was what supplied the punch. Keeping the crush fixed must not
        // come at the cost of the lift.
        listOf(9f, 27f, 81f, 203f).forEach { nits ->
            val v = nits / 10000f
            val (r, _, _) = apply(pq, v, v, v)
            val gain = (r * 10000f) / nits
            assertTrue("$nits nits should lift by >=3%, got ${(gain - 1) * 100}%", gain >= 1.03f)
        }
    }

    @Test
    fun `saturation leaves neutral grey neutral`() {
        // A luminance-preserving saturation matrix must not tint greys: the three channels
        // stay equal for any neutral input, in every space.
        listOf(sdr to 0.5f, pq to pqGrey, hlg to hlgGrey).forEach { (m, v) ->
            val (r, g, b) = apply(m, v, v, v)
            assertEquals(r.toDouble(), g.toDouble(), 1e-6)
            assertEquals(g.toDouble(), b.toDouble(), 1e-6)
        }
    }

    @Test
    fun `saturation actually increases colour separation`() {
        // A red-ish pixel must come out more saturated, or the effect does nothing.
        val (r, g, _) = apply(sdr, 0.5f, 0.2f, 0.2f)
        assertTrue("expected red to pull away from green", (r - g) > (0.5f - 0.2f))
    }

    @Test
    fun `HLG diffuse white matches the BT_2100 inverse OETF`() {
        // Same a, b, c the media3 shader uses, evaluated at signal 0.75.
        val a = 0.17883277; val b = 0.28466892; val c = 0.55991073
        val expected = (exp((0.75 - c) / a) + b) / 12.0
        assertEquals(expected, HLG_DIFFUSE_WHITE_LINEAR.toDouble(), 1e-5)
    }

    @Test
    fun `the three pivots are genuinely different scales`() {
        // If these ever collapse to one value, the transfer-function plumbing has broken and
        // HDR is about to be crushed again.
        assertTrue("PQ pivot must be far below SDR", pqGrey < sdrGrey / 10f)
        assertTrue("HLG pivot must sit between PQ and SDR", hlgGrey > pqGrey * 5f)
        assertTrue("HLG pivot must sit between PQ and SDR", hlgGrey < sdrGrey)
    }
}
