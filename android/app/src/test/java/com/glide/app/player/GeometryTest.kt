package com.glide.app.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The six resize modes, checked against the fixture shapes in tracker section 8.5:
 * 16:9, 2.39:1, portrait, and SAR != 1 anamorphic. Rotated metadata needs no case of its
 * own -- media3 applies rotation internally and reports already-rotated width/height.
 *
 * A 1080x2412 phone in landscape is 2412x1080, which is what every view size here is.
 */
class GeometryTest {

    private val viewW = 2412
    private val viewH = 1080

    private fun scaleOf(mode: String?, videoW: Int, videoH: Int, sar: Float = 1f) =
        computeGeometry(mode, viewW, viewH, videoW, videoH, sar, null).scale

    /** Rendered size after the mode is applied, as onLayout computes it. */
    private fun rendered(mode: String?, videoW: Int, videoH: Int, sar: Float = 1f): Pair<Int, Int> {
        val g = computeGeometry(mode, viewW, viewH, videoW, videoH, sar, null)
        if (g.fill) return viewW to viewH
        return Math.round(videoW * sar * g.scale) to Math.round(videoH * g.scale)
    }

    @Test
    fun `contain letterboxes a 2_39 to 1 scope frame and never overflows`() {
        val (w, h) = rendered("contain", 3840, 1600)
        assertEquals(viewW, w)              // wider than the view, so width is the limit
        assertTrue("height must fit", h <= viewH)
        assertEquals(1005, h)               // 2412 / 2.4 = 1005
    }

    @Test
    fun `cover fills both axes and crops`() {
        val (w, h) = rendered("cover", 3840, 1600)
        assertTrue("must cover width", w >= viewW)
        assertTrue("must cover height", h >= viewH)
        // 2.39:1 into 2.23:1 crops the sides, not the top.
        assertTrue("expected horizontal overflow", w > viewW)
    }

    @Test
    fun `fill stretches to the view exactly, ignoring aspect`() {
        val g = computeGeometry("fill", viewW, viewH, 1080, 1920, 1f, null)
        assertTrue(g.fill)
        assertEquals(viewW to viewH, rendered("fill", 1080, 1920))
        assertEquals(viewW to viewH, rendered("stretch", 3840, 1600))
    }

    @Test
    fun `none keeps native size even when it overflows the view`() {
        assertEquals(1f, scaleOf("none", 3840, 1600), 0f)
        assertEquals(3840 to 1600, rendered("none", 3840, 1600))
    }

    @Test
    fun `scale-down shrinks an oversized source but leaves a small one alone`() {
        assertEquals(1f, scaleOf("scale-down", 640, 360), 0f)
        assertEquals(640 to 360, rendered("scale-down", 640, 360))
        // A 4K scope frame overflows, so it must shrink to exactly what contain gives.
        assertEquals(rendered("contain", 3840, 1600), rendered("scale-down", 3840, 1600))
    }

    @Test
    fun `anamorphic SAR widens the frame rather than stretching it`() {
        // 1440x1080 with 4:3 pixels is a 1920x1080 display frame -- 16:9, so contain fills
        // the height exactly and the SAR correction is what makes that true.
        val (w, h) = rendered("contain", 1440, 1080, sar = 4f / 3f)
        assertEquals(viewH, h)
        assertEquals(1920, w)
        // Ignoring SAR would have produced a 4:3 box; assert we did not.
        assertTrue("SAR must widen the frame", w > h)
    }

    @Test
    fun `portrait source in a landscape view is limited by height`() {
        val (w, h) = rendered("contain", 1080, 1920)
        assertEquals(viewH, h)
        assertEquals(608, w)                // 1080/1920 * 1080 = 607.5
        assertTrue("must letterbox at the sides", w < viewW)
    }

    @Test
    fun `best-fit prefers cover when the crop is negligible`() {
        // 2380x1080 is 2.20:1 against the view's 2.23:1 -- cover crops about 1%, well
        // inside the enter thresholds, so filling the view is worth it.
        val g = computeGeometry("best-fit", viewW, viewH, 2380, 1080, 1f, null)
        assertTrue("expected cover", g.bestFitUsingCover == true)
        assertEquals(viewW / 2380f, g.scale, 0.001f)
    }

    @Test
    fun `best-fit falls back to contain when cover would crop hard`() {
        // 16:9 into a 2.23:1 view loses about 20% of the frame height to cover -- far past
        // the 6% enter threshold. This is the common case, and contain must win it.
        val g = computeGeometry("best-fit", viewW, viewH, 1920, 1080, 1f, null)
        assertFalse("expected contain", g.bestFitUsingCover == true)
        assertEquals(viewH / 1080f, g.scale, 0.001f)
        // 4:3 is even further out.
        assertFalse(
            computeGeometry("best-fit", viewW, viewH, 1440, 1080, 1f, null)
                .bestFitUsingCover == true
        )
    }

    @Test
    fun `best-fit hysteresis holds cover through a change that would not have entered it`() {
        // For a source narrower than the view, cropRatio and maxBar are the same quantity
        // (1 - videoW/viewW), so the gate is effectively enter <= 0.05, exit <= 0.08.
        // 2255/2412 puts it at 0.065 -- between the two. Entering from contain must refuse
        // and staying from cover must hold, which is what stops a slowly resizing window
        // oscillating between the two modes.
        val videoW = 2255
        val videoH = 1080
        val entering = computeGeometry("best-fit", viewW, viewH, videoW, videoH, 1f, false)
        val staying = computeGeometry("best-fit", viewW, viewH, videoW, videoH, 1f, true)
        assertFalse("must not enter cover", entering.bestFitUsingCover == true)
        assertTrue("must stay in cover", staying.bestFitUsingCover == true)
    }

    @Test
    fun `unmeasurable view falls back to native scale instead of dividing by zero`() {
        assertEquals(1f, scaleOf("contain", 0, 0), 0f)
        assertEquals(1f, computeGeometry("cover", 0, 0, 1920, 1080, 1f, null).scale, 0f)
        assertEquals(1f, computeGeometry("contain", viewW, viewH, 0, 0, 1f, null).scale, 0f)
    }

    @Test
    fun `unknown mode behaves as contain`() {
        assertEquals(rendered("contain", 3840, 1600), rendered("banana", 3840, 1600))
        assertEquals(rendered("contain", 3840, 1600), rendered(null, 3840, 1600))
    }
}
