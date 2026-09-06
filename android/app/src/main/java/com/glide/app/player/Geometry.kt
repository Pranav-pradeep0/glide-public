package com.glide.app.player

import kotlin.math.max
import kotlin.math.min

/**
 * The geometry decision for one resize mode, as data.
 *
 * Ported from `ReactVlcPlayerView.computeGeometry`, arithmetic and thresholds unchanged, so
 * the six modes cannot drift from the behaviour users already have. Only the *output* is
 * translated: VLC was told an aspect-ratio string and a `setScale` factor, whereas ExoPlayer
 * renders into a SurfaceView we lay out ourselves, so the answer here is a scale to apply to
 * the SAR-corrected source size, or `fill` to stretch to the view.
 *
 * Pure: no view access, no player mutation. That is what makes it testable without a device,
 * which matters for the one part of this migration the plan calls the risk peak.
 */
internal data class Geometry(
    /** Multiplier on the SAR-corrected source size. Ignored when [fill] is true. */
    val scale: Float,
    /** Stretch to the view, abandoning aspect ratio. */
    val fill: Boolean = false,
    /** New best-fit hysteresis state; null for every other mode. */
    val bestFitUsingCover: Boolean? = null,
)

// Asymmetric thresholds: once cover is chosen it takes a larger change to leave it, so a
// slowly resizing window cannot oscillate between the two.
private const val BEST_FIT_ENTER_CROP_RATIO = 0.06f
private const val BEST_FIT_EXIT_CROP_RATIO = 0.10f
private const val BEST_FIT_ENTER_BAR_RATIO = 0.05f
private const val BEST_FIT_EXIT_BAR_RATIO = 0.08f

/**
 * @param sar pixel width-to-height ratio; ExoPlayer reports it as
 *   `VideoSize.pixelWidthHeightRatio`, 1 for square pixels.
 * @param bestFitUsingCover previous best-fit state, for hysteresis; null if unset.
 */
internal fun computeGeometry(
    mode: String?,
    viewW: Int,
    viewH: Int,
    videoW: Int,
    videoH: Int,
    sar: Float,
    bestFitUsingCover: Boolean?,
): Geometry {
    // Source width corrected for non-square pixels. Everything below compares the view
    // against this, never against the raw frame width.
    val displayW = videoW * (if (sar > 0f) sar else 1f)

    if (mode == "fill" || mode == "stretch") {
        return Geometry(scale = 1f, fill = true)
    }

    if (mode == "none") {
        // Native size. Shrinking or growing to the view is exactly what this mode refuses.
        return Geometry(scale = 1f)
    }

    // Every mode below scales against the view, so it needs both to be measurable.
    if (viewW <= 0 || viewH <= 0 || displayW <= 0f || videoH <= 0) {
        return Geometry(scale = 1f)
    }

    val scaleX = viewW / displayW
    val scaleY = viewH / videoH.toFloat()
    val containScale = min(scaleX, scaleY)
    val coverScale = max(scaleX, scaleY)

    if (mode == "cover") {
        return Geometry(scale = coverScale)
    }

    if (mode == "scale-down") {
        // Native size unless the source overflows the view, and never a forced aspect:
        // shrinking must not change the shape. displayW already accounts for SAR.
        val overflows = displayW > viewW || videoH > viewH
        return Geometry(scale = if (overflows) containScale else 1f)
    }

    if (mode == "best-fit" || mode == "bestfit" || mode == "best_fit") {
        val containW = displayW * containScale
        val containH = videoH * containScale
        val coverW = displayW * coverScale
        val coverH = videoH * coverScale
        val viewArea = viewW.toFloat() * viewH

        // How much of the frame cover would crop away, and how much letterboxing contain
        // would leave. Cover is only worth it when it crops very little.
        val cropRatio = if (coverW > 0f && coverH > 0f) 1f - (viewArea / (coverW * coverH)) else 1f
        val maxBar = max(
            max(0f, (viewW - containW) / viewW),
            max(0f, (viewH - containH) / viewH),
        )

        val useCover = if (bestFitUsingCover == true) {
            cropRatio <= BEST_FIT_EXIT_CROP_RATIO && maxBar <= BEST_FIT_EXIT_BAR_RATIO
        } else {
            // cropRatio cannot be negative: cover always covers at least the view.
            cropRatio <= BEST_FIT_ENTER_CROP_RATIO &&
                maxBar <= BEST_FIT_ENTER_BAR_RATIO &&
                (containW * containH) / viewArea < 0.999f
        }
        return Geometry(
            scale = if (useCover) coverScale else containScale,
            bestFitUsingCover = useCover,
        )
    }

    // "contain", "center" and anything unrecognised. VLC expressed this as scale=0, "let
    // LibVLC fit the window"; fitting the window *is* contain.
    return Geometry(scale = containScale)
}
