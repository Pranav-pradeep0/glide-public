package com.glide.app.player

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.atan2
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Colour-enhancement arithmetic, pure and separate from the view, because every serious bug
 * this feature has had was arithmetic and not rendering. See [ColorEnhancementTest].
 *
 * One GPU pass per frame ([ColorEnhancementEffect]) runs [sdr] or [hdr]. Both do the same
 * things, each in the space where it is correct:
 *
 * 1. **Tone** -- a scene-adaptive curve. The frame's mean perceptual luminance (the "key") is
 *    measured on the GPU, smoothed over ~0.6 s and snapped on scene cuts. Dark scenes get
 *    their midtones opened, bright ones have highlights protected, and typical scenes get
 *    exactly the tuning users signed off.
 * 2. **Colour** -- saturation weighted per pixel: less boost on skin tones, in deep shadows
 *    (where chroma noise lives) and on colours already near the gamut edge (vibrance, which
 *    is also what stops boosted colours clipping and shifting hue).
 * 3. **SDR only: debanding and dither.** 8-bit sources band in skies and dark gradients.
 *
 * No local contrast ("clarity"). It was built and removed: boosting a pixel against a blurred
 * neighbourhood darkens the dark side of every strong edge for the width of the blur, and on
 * device that was a visible shadow around people against bright windows (The Boys S05E04,
 * 19:35 -- hair next to the window lost 14-21%). Only an edge-aware filter avoids that.
 *
 * [sdrMatrix] survives as the baseline: SDR with everything at neutral is *exactly* that
 * matrix, which is what users confirmed, and it is still the fallback on a GL ES 2 context.
 *
 * Every step scales with one `strength` (0..[STRENGTH_MAX], 1 = the tuned look).
 *
 * ## HDR works in ICtCp, because a matrix cannot do HDR contrast
 *
 * Linear contrast is `c * in + pivot * (1 - c)`: it needs a negative offset, and the offset
 * erases everything beneath it. HDR shadow detail lives exactly there, so no pivot is right.
 * Following ITU-R BT.2390, HDR tone and saturation happen in ICtCp: the curve on I is anchored
 * at 0 and never subtracts a constant, and scaling Ct/Cp is perceptually uniform, so
 * saturation is the same at 3 nits and at 1000.
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
 *
 * ## SDR works on media3's gamma-encoded working values
 *
 * media3's default SDR working space is BT.709 primaries with the SMPTE 170M transfer, so the
 * texture holds gamma-encoded RGB. The confirmed matrix was always applied to exactly those
 * values; [sdr] keeps doing so, which is what makes neutral settings reproduce it.
 *
 * ## Why `res/raw` overrides two media3 shaders
 *
 * Those two passes declare `precision mediump float`, which is fp16 on the Adreno this was
 * measured on, and fp16 arithmetic flushes denormals. The input pass holds PQ light on the
 * 0..10,000-nit scale before scaling it, so everything under fp16's smallest normal,
 * 6.1e-5 * 10,000 = **0.61 nits**, became exactly 0. Measured on device with a readback of
 * the texture this pass receives, on a dark HDR scene: 89.9% of pixels were 0 and nothing
 * sat between 0 and 0.61 nits. That, not any enhancement maths, is what crushed HDR blacks
 * whenever an effect was on. The copies in `res/raw` differ from media3 1.11.0's only in
 * `precision highp float`; with them, 0.0% of the same scene is 0. App resources override
 * library resources of the same name, so upgrading media3 means re-copying both files --
 * [ColorEnhancementTest] fails until that is done.
 *
 * ## Why the effect sets HDR mastering metadata
 *
 * No media3 class sets SMPTE 2086 / CTA-861.3 metadata on the EGL surface it renders to, so
 * on the effects path the display receives PQ frames with no mastering luminance and has to
 * guess the content's peak. Straight from the decoder it gets the real values. That is the
 * leading explanation for enhancement-on frames measuring ~13% darker. [eglHdrMetadata]
 * turns the video's static metadata into the EGL attributes the effect applies.
 */
internal object ColorEnhancement {

    // ---------------------------------------------------------------------------------------
    // SDR baseline -- the matrix users confirmed.
    // ---------------------------------------------------------------------------------------

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

    // ---------------------------------------------------------------------------------------
    // Shared knobs.
    // ---------------------------------------------------------------------------------------

    /** 1 is the tuned look; the slider runs 0..this. */
    const val STRENGTH_MAX = 1.5f

    /**
     * Skin keeps this fraction of the saturation boost removed at its hue. Hues measured from
     * light to dark skin (sRGB references, through each space's own transform): SDR CbCr
     * 131.7-143.9 deg, HDR CtCp 135.1-148.6 deg.
     */
    const val SKIN_PROTECT = 0.6f
    const val SKIN_HUE_SDR_DEG = 138f
    const val SKIN_HUE_HDR_DEG = 142f
    const val SKIN_WIDTH_DEG = 12f

    /** Vibrance: colours past this RGB saturation (1 - min/max) taper to [VIBRANCE_KEEP]. */
    const val VIBRANCE_FROM = 0.6f
    const val VIBRANCE_KEEP = 0.2f

    /** Deep shadows keep this fraction of the saturation boost: chroma noise lives there. */
    const val SHADOW_CHROMA_KEEP = 0.25f

    /** Frame-to-frame key jump treated as a scene cut: adapt at once instead of easing. */
    const val SCENE_CUT = 0.1f

    /** Key easing time constant, seconds. Slow enough not to pump, fast enough to follow. */
    const val SCENE_TAU_S = 0.6f

    /** Columns of the luma downsample the scene key is mipmapped from. */
    const val STATS_WIDTH = 256

    // ---------------------------------------------------------------------------------------
    // SDR, on top of the matrix.
    // ---------------------------------------------------------------------------------------

    /**
     * SDR's contrast pivot follows the scene. At 0.18 a dark scene sits almost entirely below
     * the pivot, so contrast darkens most of it -- the same failure HDR had, milder. Keys at
     * or above [SDR_KEY_TYPICAL] keep the confirmed 0.18.
     */
    const val SDR_PIVOT_DARK = 0.06f
    const val SDR_KEY_DARK = 0.12f
    const val SDR_KEY_TYPICAL = 0.30f

    /** A scene key that leaves every adaptive term at its confirmed value. */
    const val SDR_TYPICAL_SCENE = 0.40f

    /** Saturation fades in over this gamma-luma range. */
    const val SDR_SHADOW_CHROMA_LO = 0.04f
    const val SDR_SHADOW_CHROMA_HI = 0.20f

    /** Deband: flat if all four taps sit within this of the centre (gamma, 8-bit units). */
    const val DEBAND_THRESHOLD = 2.5f / 255f

    /** Deband tap distance, in pixels of a 1080-line frame; scaled with the frame. */
    const val DEBAND_RADIUS_1080 = 16f

    // ---------------------------------------------------------------------------------------
    // HDR.
    // ---------------------------------------------------------------------------------------

    /** media3's HDR working space: linear light with 1000 nits at 1.0, for PQ and HLG alike. */
    const val HDR_WORKING_NITS = 1000f

    /** ST 2084 encodes absolute light, with 10,000 nits at 1.0. */
    const val WORKING_TO_PQ = HDR_WORKING_NITS / 10000f

    /** Ct/Cp scale. Same knob and same noise trade-off as [SATURATION_SDR]. */
    const val SATURATION_HDR = 1.10f

    /**
     * The midtone lift, `I + lift * I² * (1 - I / shoulder)`. The I² makes it vanish toward
     * black (slope 1 at 0, so shadows pass straight through), and the second factor brings it
     * back to zero at [HDR_SHOULDER_NITS] and compresses gently above. On a typical scene:
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

    /**
     * Dark scenes add a constant I lift of up to this, ramped in across [HDR_TOE_LO_NITS] to
     * [HDR_TOE_HI_NITS] so the toe is untouched. A constant step in PQ is close to a constant
     * *relative* lift, so it opens a night scene's lit areas evenly:
     *
     *     key         0.5 nit  1     3      9     27    203   (all: <= +2.2% below 0.5 nits)
     *     dark .12    +2.2%  +5.4%  +14%   +14%  +13%  +8%
     *     dim .25     +2.2%  +4.1%  +8.9%  +9.7% +9.6% +7%
     *     typical     +2.2%  +2.9%  +4.1%  +5.5% +6.6% +6%
     *     bright .6   +1.4%  +1.8%  +2.7%  +3.5% +4.3% +4%
     */
    const val HDR_OPEN = 0.010f
    const val HDR_TOE_LO_NITS = 0.5f
    const val HDR_TOE_HI_NITS = 5f
    const val HDR_KEY_DARK = 0.18f
    const val HDR_KEY_TYPICAL = 0.32f

    /** Bright scenes: lift eases off by up to this fraction, protecting highlights. */
    const val HDR_BRIGHT_EASE = 0.35f
    const val HDR_KEY_BRIGHT_FROM = 0.45f
    const val HDR_KEY_BRIGHT_TO = 0.60f

    /** A scene key that leaves every adaptive term at its tuned value. */
    const val HDR_TYPICAL_SCENE = 0.40f

    /** Saturation fades in over this luminance range. */
    const val HDR_SHADOW_CHROMA_LO_NITS = 0.1f
    const val HDR_SHADOW_CHROMA_HI_NITS = 2f

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

    /** PQ I of a neutral at [nits]. */
    fun nitsToI(nits: Float) = pqEncode(nits / 10000f)

    val HDR_SHOULDER_I = nitsToI(HDR_SHOULDER_NITS)
    val HDR_TOE_LO_I = nitsToI(HDR_TOE_LO_NITS)
    val HDR_TOE_HI_I = nitsToI(HDR_TOE_HI_NITS)
    val HDR_SHADOW_CHROMA_LO_I = nitsToI(HDR_SHADOW_CHROMA_LO_NITS)
    val HDR_SHADOW_CHROMA_HI_I = nitsToI(HDR_SHADOW_CHROMA_HI_NITS)

    // BT.2100 matrices, row-major.
    val RGB_TO_LMS = bt2100(1688f, 2146f, 262f, 683f, 2951f, 462f, 99f, 309f, 3688f)
    val LMS_TO_ICTCP = bt2100(2048f, 2048f, 0f, 6610f, -13613f, 7003f, 17933f, -17390f, -543f)
    val LMS_TO_RGB = inverse(RGB_TO_LMS)
    val ICTCP_TO_LMS = inverse(LMS_TO_ICTCP)

    // ---------------------------------------------------------------------------------------
    // The per-pixel maths. Mirrored line for line by [fragmentShader].
    // ---------------------------------------------------------------------------------------

    fun smoothstep(a: Float, b: Float, x: Float): Float {
        val t = ((x - a) / (b - a)).coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }

    /** RGB saturation, 0 for neutrals and 1 on the gamut edge. */
    fun rgbSaturation(r: Float, g: Float, b: Float): Float {
        val hi = max(r, max(g, b))
        return if (hi <= 0f) 0f else 1f - min(r, min(g, b)) / hi
    }

    /**
     * How much of the saturation boost this pixel gets, 0..1: skin, shadow and vibrance
     * protection multiplied. [shadow] is the 0..1 shadow ramp.
     */
    fun chromaWeight(hueDeg: Float, skinHueDeg: Float, shadow: Float, saturation: Float): Float {
        val dh = ((hueDeg - skinHueDeg) % 360f + 540f) % 360f - 180f
        val skin = 1f - SKIN_PROTECT * exp(-dh * dh / (2f * SKIN_WIDTH_DEG * SKIN_WIDTH_DEG))
        val dark = SHADOW_CHROMA_KEEP + (1f - SHADOW_CHROMA_KEEP) * shadow
        val vibrance = 1f - (1f - VIBRANCE_KEEP) * smoothstep(VIBRANCE_FROM, 1f, saturation)
        return skin * dark * vibrance
    }

    /** The scene-adaptive curve on I. See [HDR_LIFT] and [HDR_OPEN]. */
    fun hdrCurve(i: Float, key: Float, strength: Float = 1f): Float {
        val lift = HDR_LIFT * strength *
            (1f - HDR_BRIGHT_EASE * smoothstep(HDR_KEY_BRIGHT_FROM, HDR_KEY_BRIGHT_TO, key))
        val open = HDR_OPEN * strength * (1f - smoothstep(HDR_KEY_DARK, HDR_KEY_TYPICAL, key))
        val shoulder = 1f - i / HDR_SHOULDER_I
        return i + lift * i * i * shoulder + open * smoothstep(HDR_TOE_LO_I, HDR_TOE_HI_I, i) * shoulder
    }

    /** Working-space linear BT.2020 to ICtCp. */
    fun toIctcp(r: Float, g: Float, b: Float): FloatArray {
        val lms = mul(RGB_TO_LMS, floatArrayOf(r, g, b))
        return mul(LMS_TO_ICTCP, FloatArray(3) { pqEncode(lms[it] * WORKING_TO_PQ) })
    }

    /** The HDR enhancement on one working-space pixel. [key] is the scene's smoothed mean I. */
    fun hdr(
        r: Float, g: Float, b: Float,
        strength: Float = 1f,
        key: Float = HDR_TYPICAL_SCENE,
    ): FloatArray {
        val (i, ct, cp) = toIctcp(r, g, b)
        val iOut = hdrCurve(i, key, strength)

        val hue = Math.toDegrees(atan2(cp, ct).toDouble()).toFloat()
        val shadow = smoothstep(HDR_SHADOW_CHROMA_LO_I, HDR_SHADOW_CHROMA_HI_I, i)
        val w = chromaWeight(hue, SKIN_HUE_HDR_DEG, shadow, rgbSaturation(r, g, b))
        val s = 1f + (SATURATION_HDR - 1f) * strength * w

        val lms = mul(ICTCP_TO_LMS, floatArrayOf(iOut, ct * s, cp * s))
        val rgb = mul(LMS_TO_RGB, FloatArray(3) { pqDecode(lms[it]) / WORKING_TO_PQ })
        return FloatArray(3) { max(rgb[it], 0f) }
    }

    /**
     * The SDR enhancement on one gamma-encoded working pixel. At [strength] 1, a typical
     * [key] and a pixel the colour protections leave alone, this is exactly
     * [sdrMatrix]. Debanding and dither are spatial and live only in the shader.
     */
    fun sdr(
        r: Float, g: Float, b: Float,
        strength: Float = 1f,
        key: Float = SDR_TYPICAL_SCENE,
    ): FloatArray {
        val y = 0.2126f * r + 0.7152f * g + 0.0722f * b
        val hue = Math.toDegrees(atan2((r - y) / 1.5748f, (b - y) / 1.8556f).toDouble()).toFloat()
        val shadow = smoothstep(SDR_SHADOW_CHROMA_LO, SDR_SHADOW_CHROMA_HI, y)
        val w = chromaWeight(hue, SKIN_HUE_SDR_DEG, shadow, rgbSaturation(r, g, b))
        val s = 1f + (SATURATION_SDR - 1f) * strength * w
        val c = 1f + (CONTRAST_SDR - 1f) * strength
        val pivot = SDR_PIVOT_DARK +
            (MID_GREY_FRACTION - SDR_PIVOT_DARK) * smoothstep(SDR_KEY_DARK, SDR_KEY_TYPICAL, key)
        return floatArrayOf(r, g, b).let { rgb ->
            FloatArray(3) { ((y + s * (rgb[it] - y)) * c + pivot * (1f - c)).coerceIn(0f, 1f) }
        }
    }

    /**
     * The video's static HDR metadata (media3 `ColorInfo.hdrStaticInfo`: one descriptor byte,
     * then little-endian shorts R, G, B and white x/y in 0.00002 units, max and min mastering
     * luminance, MaxCLL, MaxFALL) as EGL surface attribute/value pairs, or null if absent.
     *
     * Chromaticities already sit at EGL's 50000 scale. Min luminance is skipped: media3's
     * Matroska path rounds it to whole nits, so a 0.005-nit master arrives as 0.
     */
    fun eglHdrMetadata(info: ByteArray?): IntArray? {
        if (info == null || info.size < 25 || info[0].toInt() != 0) return null
        val buf = ByteBuffer.wrap(info, 1, 24).order(ByteOrder.LITTLE_ENDIAN)
        val v = IntArray(12) { buf.short.toInt() and 0xffff }
        if (v[8] == 0) return null
        val out = mutableListOf<Int>()
        for (k in 0 until 8) out += listOf(EGL_SMPTE2086_DISPLAY_PRIMARY_RX + k, v[k])
        out += listOf(EGL_SMPTE2086_MAX_LUMINANCE, min(v[8], 10000) * EGL_METADATA_SCALING)
        if (v[10] > 0) out += listOf(EGL_CTA861_3_MAX_CONTENT_LIGHT_LEVEL, min(v[10], 10000) * EGL_METADATA_SCALING)
        if (v[11] > 0) out += listOf(EGL_CTA861_3_MAX_FRAME_AVERAGE_LEVEL, min(v[11], 10000) * EGL_METADATA_SCALING)
        return out.toIntArray()
    }

    // EGL_EXT_surface_SMPTE2086_metadata / EGL_EXT_surface_CTA861_3_metadata.
    const val EGL_SMPTE2086_DISPLAY_PRIMARY_RX = 0x3341
    const val EGL_SMPTE2086_MAX_LUMINANCE = 0x3349
    const val EGL_CTA861_3_MAX_CONTENT_LIGHT_LEVEL = 0x3360
    const val EGL_CTA861_3_MAX_FRAME_AVERAGE_LEVEL = 0x3361
    const val EGL_METADATA_SCALING = 50000

    // ---------------------------------------------------------------------------------------
    // GLSL. Every number is spliced in from the constants above, so the shader cannot drift
    // from the Kotlin the tests exercise.
    // ---------------------------------------------------------------------------------------

    const val VERTEX_SHADER = """#version 300 es
in vec4 aFramePosition;
out vec2 vTexSamplingCoord;
void main() {
  gl_Position = aFramePosition;
  vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5;
}
"""

    private fun f(x: Float) = x.toString()

    private fun mat3(m: FloatArray) =
        "mat3(" + intArrayOf(0, 3, 6, 1, 4, 7, 2, 5, 8).joinToString(", ") { f(m[it]) } + ")"

    private fun common(hdr: Boolean) = """#version 300 es
precision highp float;
const float M1 = ${f(M1)};
const float M2 = ${f(M2)};
const float C1 = ${f(C1)};
const float C2 = ${f(C2)};
const float C3 = ${f(C3)};
const mat3 RGB_TO_LMS = ${mat3(RGB_TO_LMS)};
const mat3 LMS_TO_ICTCP = ${mat3(LMS_TO_ICTCP)};
const mat3 ICTCP_TO_LMS = ${mat3(ICTCP_TO_LMS)};
const mat3 LMS_TO_RGB = ${mat3(LMS_TO_RGB)};
const float WORKING_TO_PQ = ${f(WORKING_TO_PQ)};
const vec3 LUMA709 = vec3(0.2126, 0.7152, 0.0722);

vec3 pqEncode(vec3 l) {
  vec3 y = pow(max(l, 0.0), vec3(M1));
  return pow((C1 + C2 * y) / (1.0 + C3 * y), vec3(M2));
}

vec3 pqDecode(vec3 v) {
  vec3 t = pow(clamp(v, 0.0, 1.0), vec3(1.0 / M2));
  return pow(max(t - C1, 0.0) / (C2 - C3 * t), vec3(1.0 / M1));
}

// The perceptual luminance everything adapts to: PQ I for HDR, gamma luma for SDR.
float perceptualLuma(vec3 c) {
  ${if (hdr) "vec3 lms = pqEncode(RGB_TO_LMS * c * WORKING_TO_PQ); return 0.5 * (lms.x + lms.y);"
    else "return dot(c, LUMA709);"}
}
"""

    /** Downsamples the frame to [STATS_WIDTH] columns of perceptual luma, for mipmapping. */
    fun statsShader(hdr: Boolean) = common(hdr) + """
uniform sampler2D uTex;
uniform vec2 uFootprint;
in vec2 vTexSamplingCoord;
out vec4 outColor;
void main() {
  vec2 o = uFootprint * 0.25;
  float v = perceptualLuma(texture(uTex, vTexSamplingCoord + vec2(-o.x, -o.y)).rgb)
          + perceptualLuma(texture(uTex, vTexSamplingCoord + vec2( o.x, -o.y)).rgb)
          + perceptualLuma(texture(uTex, vTexSamplingCoord + vec2(-o.x,  o.y)).rgb)
          + perceptualLuma(texture(uTex, vTexSamplingCoord + vec2( o.x,  o.y)).rgb);
  outColor = vec4(0.25 * v, 0.0, 0.0, 1.0);
}
"""

    /** Eases the 1x1 scene key toward this frame's mean; snaps on a cut or when told to. */
    val STATE_SHADER = common(false) + """
uniform sampler2D uStats;
uniform sampler2D uPrev;
uniform float uAlpha;
out vec4 outColor;
void main() {
  float mean = textureLod(uStats, vec2(0.5), 16.0).r;
  float prev = texture(uPrev, vec2(0.5)).r;
  float a = abs(mean - prev) > ${f(SCENE_CUT)} ? 1.0 : uAlpha;
  outColor = vec4(mix(prev, mean, a), 0.0, 0.0, 1.0);
}
"""

    fun fragmentShader(hdr: Boolean) = common(hdr) + """
uniform sampler2D uTex;
uniform sampler2D uState;
uniform float uStrength;
uniform vec2 uDebandStep;
in vec2 vTexSamplingCoord;
out vec4 outColor;

float chromaWeight(float hueDeg, float skinHueDeg, float shadow, vec3 rgb) {
  float dh = mod(hueDeg - skinHueDeg + 540.0, 360.0) - 180.0;
  float skin = 1.0 - ${f(SKIN_PROTECT)} * exp(-dh * dh / ${f(2f * SKIN_WIDTH_DEG * SKIN_WIDTH_DEG)});
  float dark = ${f(SHADOW_CHROMA_KEEP)} + ${f(1f - SHADOW_CHROMA_KEEP)} * shadow;
  float hi = max(rgb.r, max(rgb.g, rgb.b));
  float sat = hi <= 0.0 ? 0.0 : 1.0 - min(rgb.r, min(rgb.g, rgb.b)) / hi;
  float vibrance = 1.0 - ${f(1f - VIBRANCE_KEEP)} * smoothstep(${f(VIBRANCE_FROM)}, 1.0, sat);
  return skin * dark * vibrance;
}

// Interleaved gradient noise: cheap, static, well distributed.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
""" + if (hdr) hdrMain() else sdrMain()

    private fun hdrMain() = """
void main() {
  vec4 src = texture(uTex, vTexSamplingCoord);
  vec3 ictcp = LMS_TO_ICTCP * pqEncode(RGB_TO_LMS * src.rgb * WORKING_TO_PQ);
  float i = ictcp.x;
  float key = texture(uState, vec2(0.5)).r;
  float shoulder = 1.0 - i / ${f(HDR_SHOULDER_I)};
  float lift = ${f(HDR_LIFT)} * uStrength
      * (1.0 - ${f(HDR_BRIGHT_EASE)} * smoothstep(${f(HDR_KEY_BRIGHT_FROM)}, ${f(HDR_KEY_BRIGHT_TO)}, key));
  float open = ${f(HDR_OPEN)} * uStrength * (1.0 - smoothstep(${f(HDR_KEY_DARK)}, ${f(HDR_KEY_TYPICAL)}, key));
  float toe = smoothstep(${f(HDR_TOE_LO_I)}, ${f(HDR_TOE_HI_I)}, i);
  float iOut = i + lift * i * i * shoulder + open * toe * shoulder;

  // atan(0, 0) is undefined in GLSL and NaN on some GPUs; neutrals have no hue to protect.
  float hue = abs(ictcp.y) + abs(ictcp.z) > 1e-7 ? degrees(atan(ictcp.z, ictcp.y)) : 0.0;
  float shadow = smoothstep(${f(HDR_SHADOW_CHROMA_LO_I)}, ${f(HDR_SHADOW_CHROMA_HI_I)}, i);
  float s = 1.0 + ${f(SATURATION_HDR - 1f)} * uStrength
      * chromaWeight(hue, ${f(SKIN_HUE_HDR_DEG)}, shadow, src.rgb);

  vec3 rgb = LMS_TO_RGB * (pqDecode(ICTCP_TO_LMS * vec3(iOut, ictcp.yz * s)) / WORKING_TO_PQ);
  // media3's final pass feeds this straight to pow, which is undefined below 0.
  outColor = vec4(max(rgb, 0.0), src.a);
}
"""

    private fun sdrMain() = """
// Replace a pixel by its neighbourhood only where the neighbourhood is flat to within an
// 8-bit step or two: that is banding, not detail.
vec3 deband(vec2 uv, vec3 c) {
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  vec2 d = vec2(cos(ang), sin(ang)) * uDebandStep;
  vec3 a = texture(uTex, uv + d).rgb;
  vec3 b = texture(uTex, uv - d).rgb;
  vec3 e = texture(uTex, uv + vec2(-d.y, d.x)).rgb;
  vec3 f = texture(uTex, uv + vec2(d.y, -d.x)).rgb;
  vec3 diff = max(max(abs(a - c), abs(b - c)), max(abs(e - c), abs(f - c)));
  return all(lessThan(diff, vec3(${f(DEBAND_THRESHOLD)}))) ? 0.25 * (a + b + e + f) : c;
}

void main() {
  vec4 src = texture(uTex, vTexSamplingCoord);
  vec3 c = deband(vTexSamplingCoord, src.rgb);
  float y = dot(c, LUMA709);
  float key = texture(uState, vec2(0.5)).r;

  vec2 cbcr = vec2((c.b - y) / 1.8556, (c.r - y) / 1.5748);
  float hue = abs(cbcr.x) + abs(cbcr.y) > 1e-7 ? degrees(atan(cbcr.y, cbcr.x)) : 0.0;
  float shadow = smoothstep(${f(SDR_SHADOW_CHROMA_LO)}, ${f(SDR_SHADOW_CHROMA_HI)}, y);
  float s = 1.0 + ${f(SATURATION_SDR - 1f)} * uStrength * chromaWeight(hue, ${f(SKIN_HUE_SDR_DEG)}, shadow, c);
  float k = 1.0 + ${f(CONTRAST_SDR - 1f)} * uStrength;
  float pivot = ${f(SDR_PIVOT_DARK)}
      + ${f(MID_GREY_FRACTION - SDR_PIVOT_DARK)} * smoothstep(${f(SDR_KEY_DARK)}, ${f(SDR_KEY_TYPICAL)}, key);

  vec3 rgb = (y + s * (c - y)) * k + pivot * (1.0 - k);
  // Triangular dither of one 8-bit step, so the smoothed gradient survives quantisation.
  float n = ign(gl_FragCoord.xy) + ign(gl_FragCoord.yx + 17.0) - 1.0;
  outColor = vec4(clamp(rgb + n / 255.0, 0.0, 1.0), src.a);
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
