package com.glide.app.player

import kotlin.math.max
import kotlin.math.pow

/**
 * Colour-enhancement arithmetic, pure and separate from the view, because every serious bug
 * this feature has had was arithmetic and not rendering. See [ColorEnhancementTest].
 *
 * Two paths, because one linear matrix cannot serve both:
 *
 * - **SDR: [sdrMatrix]**, an `RgbMatrix` of luminance-preserving saturation then contrast
 *   about mid-grey. Users confirmed it looks right; HDR work must not retune it.
 * - **HDR: [hdr]**, run per pixel on the GPU by [HDR_FRAGMENT_SHADER] ([HdrColorEnhancement]).
 *   A matrix is linear, so contrast is `c * in + pivot * (1 - c)`: it needs a negative
 *   offset, and the offset erases everything beneath it. HDR shadow detail lives exactly
 *   there, so no pivot is right. Instead, following ITU-R BT.2390, the HDR path works in
 *   ICtCp: a curve on I anchored at 0 that lifts midtones and rolls off highlights without
 *   ever subtracting a constant, and a scale on Ct/Cp, which is perceptually uniform, so
 *   saturation is the same at 3 nits and at 1000.
 *
 * ## The HDR working scale is 1.0 = 1000 nits, not 10,000
 *
 * Between passes media3 holds HDR as linear BT.2020 in RGBA16F. Its input shader
 * (`fragment_shader_transformation_external_yuv_es3.glsl`, `scaleHdrLuminance`) multiplies PQ
 * light by 10000 / 1000, and its final pass (`fragment_shader_oetf_es3.glsl`,
 * `normalizeHdrLuminance`) divides it back before the PQ OETF. HLG stays scene light with
 * its peak at 1.0, which media3 also calls 1000 nits. So PQ and HLG share one scale here and
 * the transfer function does not need to be known. The `* pqMaxLuminance` line that earlier
 * notes quoted belongs to the HDR-to-SDR tone-mapping branch, which does not run when the
 * output is HDR.
 */
internal object ColorEnhancement {

    /** The calibration knob. More colour is also more chroma noise, worst in dark scenes. */
    const val SATURATION_SDR = 1.18f
    const val CONTRAST_SDR = 1.07f

    /** Mid-grey is 18% of diffuse white -- the photographic grey card. */
    const val MID_GREY_FRACTION = 0.18f

    /**
     * Column-major 4x4 for GL: element (row i, col j) is at index j * 4 + i, so the
     * translation occupies indices 12..14.
     */
    fun sdrMatrix(): FloatArray {
        val (lr, lg, lb) = Triple(0.2126f, 0.7152f, 0.0722f)   // BT.709 luma weights
        val s = SATURATION_SDR
        val c = CONTRAST_SDR
        val inv = 1f - s
        val offset = MID_GREY_FRACTION * (1f - c)
        return floatArrayOf(
            (lr * inv + s) * c, (lr * inv) * c, (lr * inv) * c, 0f,
            (lg * inv) * c, (lg * inv + s) * c, (lg * inv) * c, 0f,
            (lb * inv) * c, (lb * inv) * c, (lb * inv + s) * c, 0f,
            offset, offset, offset, 1f
        )
    }

    /** Apply [sdrMatrix] to an RGB triple, as the fragment shader would. */
    fun apply(m: FloatArray, r: Float, g: Float, b: Float): Triple<Float, Float, Float> =
        Triple(
            m[0] * r + m[4] * g + m[8] * b + m[12],
            m[1] * r + m[5] * g + m[9] * b + m[13],
            m[2] * r + m[6] * g + m[10] * b + m[14],
        )

    /** media3's HDR working space: linear light with 1000 nits at 1.0, for PQ and HLG alike. */
    const val HDR_WORKING_NITS = 1000f

    /** ST 2084 encodes absolute light, with 10,000 nits at 1.0. */
    const val WORKING_TO_PQ = HDR_WORKING_NITS / 10000f

    /** Ct/Cp scale. Same knob and same noise trade-off as [SATURATION_SDR]. */
    const val SATURATION_HDR = 1.10f

    /**
     * The midtone lift, `I + lift * I² * (1 - I / shoulder)`. The I² makes it vanish toward
     * black (slope 1 at 0, so shadows pass straight through), and the second factor brings it
     * back to zero at [HDR_SHOULDER_NITS] and compresses gently above.
     *
     *     nits      0.01   0.1    1      9      81     203    1000   4000
     *     curve    +0.3%  +1.1%  +2.9%  +5.5%  +7.0%  +6.0%   0.0%  -11%
     *     matrix    -54%   0.0%  +5.4%  +5.9%  +6.0%  +6.0%  +6.0%   +6%
     *
     * "matrix" is the `RgbMatrix` this replaced: contrast 1.06 about 0.1 nits. Through the
     * diffuse range the two match, which is the part users liked. Below 0.1 nits the matrix
     * erased shadow detail, and above 1000 it pushed highlights past the mastering peak.
     */
    const val HDR_LIFT = 0.08f

    /** Where the lift returns to zero: the common mastering peak, and working 1.0. */
    const val HDR_SHOULDER_NITS = 1000f

    // SMPTE ST 2084.
    private const val M1 = 2610f / 16384f
    private const val M2 = 2523f / 4096f * 128f
    private const val C1 = 3424f / 4096f
    private const val C2 = 2413f / 4096f * 32f
    private const val C3 = 2392f / 4096f * 32f

    /** Linear light over 10,000 nits to the PQ signal. */
    fun pqEncode(l: Float): Float {
        val y = max(l, 0f).pow(M1)
        return ((C1 + C2 * y) / (1f + C3 * y)).pow(M2)
    }

    /** The PQ signal back to linear light over 10,000 nits. */
    fun pqDecode(v: Float): Float {
        val t = v.coerceIn(0f, 1f).pow(1f / M2)
        return (max(t - C1, 0f) / (C2 - C3 * t)).pow(1f / M1)
    }

    val HDR_SHOULDER_I = pqEncode(HDR_SHOULDER_NITS / 10000f)

    // BT.2100 matrices, row-major.
    val RGB_TO_LMS = bt2100(1688f, 2146f, 262f, 683f, 2951f, 462f, 99f, 309f, 3688f)
    val LMS_TO_ICTCP = bt2100(2048f, 2048f, 0f, 6610f, -13613f, 7003f, 17933f, -17390f, -543f)
    val LMS_TO_RGB = inverse(RGB_TO_LMS)
    val ICTCP_TO_LMS = inverse(LMS_TO_ICTCP)

    /** Working-space linear BT.2020 to ICtCp. */
    fun toIctcp(r: Float, g: Float, b: Float): FloatArray {
        val lms = mul(RGB_TO_LMS, floatArrayOf(r, g, b))
        return mul(LMS_TO_ICTCP, FloatArray(3) { pqEncode(lms[it] * WORKING_TO_PQ) })
    }

    /** The HDR enhancement on one working-space pixel. Mirrors [HDR_FRAGMENT_SHADER]. */
    fun hdr(
        r: Float, g: Float, b: Float,
        lift: Float = HDR_LIFT,
        saturation: Float = SATURATION_HDR,
    ): FloatArray {
        val (i, ct, cp) = toIctcp(r, g, b)
        val curved = i + lift * i * i * (1f - i / HDR_SHOULDER_I)
        val lms = mul(ICTCP_TO_LMS, floatArrayOf(curved, ct * saturation, cp * saturation))
        val rgb = mul(LMS_TO_RGB, FloatArray(3) { pqDecode(lms[it]) / WORKING_TO_PQ })
        return FloatArray(3) { max(rgb[it], 0f) }
    }

    /**
     * [hdr], per pixel. Matrices arrive column-major, as GL expects. The output is clamped
     * at 0 because media3's final pass feeds it straight to `pow`, which is undefined below 0.
     */
    const val HDR_FRAGMENT_SHADER = """#version 300 es
precision highp float;
uniform sampler2D uTexSampler;
uniform mat3 uRgbToLms;
uniform mat3 uLmsToIctcp;
uniform mat3 uIctcpToLms;
uniform mat3 uLmsToRgb;
uniform float uWorkingToPq;
uniform float uLift;
uniform float uShoulder;
uniform float uSaturation;
in vec2 vTexSamplingCoord;
out vec4 outColor;

const float M1 = 2610.0 / 16384.0;
const float M2 = 2523.0 / 4096.0 * 128.0;
const float C1 = 3424.0 / 4096.0;
const float C2 = 2413.0 / 4096.0 * 32.0;
const float C3 = 2392.0 / 4096.0 * 32.0;

vec3 pqEncode(vec3 l) {
  vec3 y = pow(max(l, 0.0), vec3(M1));
  return pow((C1 + C2 * y) / (1.0 + C3 * y), vec3(M2));
}

vec3 pqDecode(vec3 v) {
  vec3 t = pow(clamp(v, 0.0, 1.0), vec3(1.0 / M2));
  return pow(max(t - C1, 0.0) / (C2 - C3 * t), vec3(1.0 / M1));
}

void main() {
  vec4 src = texture(uTexSampler, vTexSamplingCoord);
  vec3 ictcp = uLmsToIctcp * pqEncode(uRgbToLms * src.rgb * uWorkingToPq);
  float i = ictcp.x;
  ictcp.x = i + uLift * i * i * (1.0 - i / uShoulder);
  ictcp.yz *= uSaturation;
  vec3 rgb = uLmsToRgb * (pqDecode(uIctcpToLms * ictcp) / uWorkingToPq);
  outColor = vec4(max(rgb, 0.0), src.a);
}
"""

    private fun bt2100(vararg m: Float) = FloatArray(9) { m[it] / 4096f }

    private fun mul(m: FloatArray, v: FloatArray) = FloatArray(3) {
        m[it * 3] * v[0] + m[it * 3 + 1] * v[1] + m[it * 3 + 2] * v[2]
    }

    /** Row-major 3x3 inverse: the adjugate over the determinant. */
    private fun inverse(m: FloatArray): FloatArray {
        val adj = floatArrayOf(
            m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
            m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
            m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
        )
        val det = m[0] * adj[0] + m[1] * adj[3] + m[2] * adj[6]
        return FloatArray(9) { adj[it] / det }
    }
}
