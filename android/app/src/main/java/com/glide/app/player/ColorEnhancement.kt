package com.glide.app.player

/**
 * The colour-enhancement matrix: luminance-preserving saturation, then contrast about
 * mid-grey.
 *
 * Pure arithmetic, deliberately separated from the view, because the one serious bug this
 * feature has had was arithmetic and not rendering. See [ColorEnhancementTest].
 *
 * ## Why the pivot depends on the transfer function
 *
 * `RgbMatrix` hands the shader *linear* RGB, and "linear" is not the same scale for SDR and
 * HDR. From media3's own shader, `fragment_shader_transformation_external_yuv_es3.glsl`:
 *
 *     // Input and output are both normalized to [0, 1].
 *     const float pqMaxLuminance = 10000.0;
 *     linearRgbBt2020 = linearRgbBt2020 * pqMaxLuminance;  // Scale luminance.
 *
 * So under PQ, linear 1.0 is **10,000 nits** -- not white. An earlier version pivoted
 * contrast at 0.18 regardless, which in PQ space means 1800 nits, roughly nine times
 * diffuse white. The offset `0.18 * (1 - c)` then subtracted more than the entire value of
 * every midtone: mid-grey sits at 0.00365 and the offset was -0.0063, so everything below
 * about 61 nits clamped to pure black. That is most of the picture, and it is why HDR
 * looked far worse than SDR rather than merely different.
 *
 * Mid-grey is 18% of diffuse white in whichever space we are in, and diffuse white is:
 *   - SDR: 1.0 by definition.
 *   - PQ:  203 / 10000, from ITU-R BT.2408's HDR Reference White of 203 cd/m².
 *   - HLG: 0.264963, the BT.2100 HLG inverse OETF at signal 0.75 (reference white),
 *          `(exp((0.75 - c) / a) + b) / 12` with the same a, b, c the shader uses.
 *
 * PQ and HLG pivots differ by 13x, so `useHdr` alone is not enough to choose between them.
 *
 * Saturation needs no pivot -- it is a pure linear mix -- but is gentler on HDR on purpose:
 * BT.2020 is a far wider gamut than BT.709, so an equal boost pushes colours past what the
 * panel can show, where they clip and shift hue.
 */
internal object ColorEnhancement {

    /** The calibration knob. More colour is also more chroma noise, worst in dark scenes. */
    const val SATURATION_SDR = 1.18f
    const val SATURATION_HDR = 1.10f

    const val CONTRAST_SDR = 1.07f
    const val CONTRAST_HDR = 1.06f

    /** Mid-grey is 18% of diffuse white -- the photographic grey card. */
    const val MID_GREY_FRACTION = 0.18f

    /** ITU-R BT.2408 HDR Reference White, over the ST.2084 peak media3 normalises against. */
    const val PQ_DIFFUSE_WHITE_LINEAR = 203f / 10000f

    /** BT.2100 HLG inverse OETF evaluated at signal 0.75. */
    const val HLG_DIFFUSE_WHITE_LINEAR = 0.264963f

    /**
     * **The HDR contrast pivot, and the whole of what took five attempts to get right.**
     *
     * Contrast is `out = c * in + pivot * (1 - c)`. Everything *below* the pivot darkens;
     * everything above brightens. Choosing mid-grey is an SDR convention and it is correct
     * there, because an SDR frame's tones straddle mid-grey by construction.
     *
     * HDR frames routinely do not. A night scene lies *entirely* below PQ mid-grey (36.5
     * nits), so pivoting there darkened the scene's lit areas along with its shadows and the
     * picture read as a black smear — measured, not guessed:
     *
     *     pivot 36.5 nits          pivot 1 nit
     *       1 nit ->  0.00 (-100%)   1 nit ->    1.00  (pivot)
     *       3 nit ->  0.99 ( -67%)   3 nit ->    3.12  (+4%)
     *       9 nit ->  7.35 ( -18%)   9 nit ->    9.48  (+5%)
     *      27 nit -> 26.43 (  -2%)  27 nit ->   28.56  (+6%)
     *      81 nit -> 83.67 (  +3%)  81 nit ->   85.80  (+6%)
     *                              1000 nit -> 1059.94 (+6%)
     *
     * Pinning the pivot at the shadow floor instead keeps the punch — more of it, in fact,
     * since the whole diffuse range is now above the pivot — while the largest possible
     * darkening anywhere becomes 0.06 nits, which is below any panel's black floor and so
     * cannot be seen.
     *
     * 1 nit is chosen as comfortably beneath any content worth preserving: HDR shadow detail
     * that a viewer can actually resolve lives above it, and true black sits at 0.
     *
     * This is a straight line, so it is still not a tone curve: it cannot lift midtones while
     * leaving highlights alone, and it has no shoulder. That wants a custom shader operating
     * in a perceptual space (BT.2390 recommends ICtCp for HDR, precisely because per-channel
     * operations in linear light distort colour). Raising [CONTRAST_HDR] is not a substitute
     * and will start clipping highlights.
     */
    const val HDR_PIVOT_NITS = 1f

    fun diffuseWhiteLinear(useHdr: Boolean, isHlg: Boolean): Float = when {
        !useHdr -> 1f
        isHlg -> HLG_DIFFUSE_WHITE_LINEAR
        else -> PQ_DIFFUSE_WHITE_LINEAR
    }

    /**
     * Where contrast pivots. SDR pivots on mid-grey; HDR pivots on the shadow floor, for the
     * reason set out on [HDR_PIVOT_NITS].
     */
    fun contrastPivot(useHdr: Boolean, isHlg: Boolean): Float = when {
        !useHdr -> MID_GREY_FRACTION
        // HLG normalises to peak rather than to 10,000 nits, so the same absolute nit level
        // is a different linear value. Scale it by the ratio of the two diffuse whites.
        isHlg -> (HDR_PIVOT_NITS / 10000f) * (HLG_DIFFUSE_WHITE_LINEAR / PQ_DIFFUSE_WHITE_LINEAR)
        else -> HDR_PIVOT_NITS / 10000f
    }

    /**
     * Column-major 4x4 for GL: element (row i, col j) is at index j * 4 + i, so the
     * translation occupies indices 12..14.
     */
    fun matrix(useHdr: Boolean, isHlg: Boolean): FloatArray {
        val (lr, lg, lb) = if (useHdr) {
            Triple(0.2627f, 0.6780f, 0.0593f)   // BT.2020 luma weights
        } else {
            Triple(0.2126f, 0.7152f, 0.0722f)   // BT.709
        }
        val s = if (useHdr) SATURATION_HDR else SATURATION_SDR
        val c = if (useHdr) CONTRAST_HDR else CONTRAST_SDR
        val pivot = contrastPivot(useHdr, isHlg)

        val inv = 1f - s
        val offset = pivot * (1f - c)
        return floatArrayOf(
            (lr * inv + s) * c, (lr * inv) * c, (lr * inv) * c, 0f,
            (lg * inv) * c, (lg * inv + s) * c, (lg * inv) * c, 0f,
            (lb * inv) * c, (lb * inv) * c, (lb * inv + s) * c, 0f,
            offset, offset, offset, 1f
        )
    }

    /** Apply [matrix] to a linear RGB triple, as the fragment shader would. */
    fun apply(m: FloatArray, r: Float, g: Float, b: Float): Triple<Float, Float, Float> =
        Triple(
            m[0] * r + m[4] * g + m[8] * b + m[12],
            m[1] * r + m[5] * g + m[9] * b + m[13],
            m[2] * r + m[6] * g + m[10] * b + m[14],
        )
}
