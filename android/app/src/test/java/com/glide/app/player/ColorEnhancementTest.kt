package com.glide.app.player

import com.glide.app.player.ColorEnhancement.HDR_WORKING_NITS
import com.glide.app.player.ColorEnhancement.MID_GREY_FRACTION
import com.glide.app.player.ColorEnhancement.SATURATION_HDR
import com.glide.app.player.ColorEnhancement.STRENGTH_MAX
import com.glide.app.player.ColorEnhancement.apply
import com.glide.app.player.ColorEnhancement.eglHdrMetadata
import com.glide.app.player.ColorEnhancement.hdr
import com.glide.app.player.ColorEnhancement.hdrCurve
import com.glide.app.player.ColorEnhancement.nitsToI
import com.glide.app.player.ColorEnhancement.sdr
import com.glide.app.player.ColorEnhancement.sdrMatrix
import com.glide.app.player.ColorEnhancement.toIctcp
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot

/**
 * The enhancement is pure arithmetic, and its serious defects have all been arithmetic: a
 * contrast pivot that crushed HDR midtones, then a matrix offset that erased HDR shadows.
 * None of this needs a device.
 *
 * Shadow checks are **relative**. An absolute nit tolerance hides a 100% loss at 0.01 nits.
 */
class ColorEnhancementTest {

    private val matrix = sdrMatrix()

    /** A neutral HDR pixel at [nits], through the enhancement, back in nits. */
    private fun hdrNits(nits: Float, key: Float = ColorEnhancement.HDR_TYPICAL_SCENE): Float {
        val v = nits / HDR_WORKING_NITS
        return hdr(v, v, v, key = key)[1] * HDR_WORKING_NITS
    }

    /** How much the HDR enhancement multiplies this pixel's ICtCp chroma. */
    private fun hdrChromaGain(rgb: FloatArray, strength: Float = 1f): Float {
        val (_, ct, cp) = toIctcp(rgb[0], rgb[1], rgb[2])
        val (r, g, b) = hdr(rgb[0], rgb[1], rgb[2], strength = strength)
        val (_, ct2, cp2) = toIctcp(r, g, b)
        return hypot(ct2, cp2) / hypot(ct, cp)
    }

    /** How much the SDR enhancement multiplies this pixel's CbCr chroma. */
    private fun sdrChromaGain(rgb: FloatArray): Float {
        fun chroma(c: FloatArray): Float {
            val y = 0.2126f * c[0] + 0.7152f * c[1] + 0.0722f * c[2]
            return hypot((c[2] - y) / 1.8556f, (c[0] - y) / 1.5748f)
        }
        return chroma(sdr(rgb[0], rgb[1], rgb[2])) / chroma(rgb)
    }

    private fun working(nits: Float, vararg shape: Float) =
        FloatArray(3) { shape[it] * nits / HDR_WORKING_NITS }

    // ---------------------------------------------------------------------------------------
    // SDR: the confirmed look is the baseline.
    // ---------------------------------------------------------------------------------------

    @Test
    fun `SDR matrix is exactly what users signed off`() {
        // These are the values the confirmed build shipped. The ES 2 fallback still uses them.
        assertArrayEquals(
            floatArrayOf(
                1.221653f, -0.04094675f, -0.04094675f, 0f,
                -0.1377475f, 1.124853f, -0.1377475f, 0f,
                -0.01390572f, -0.01390572f, 1.248694f, 0f,
                -0.01260001f, -0.01260001f, -0.01260001f, 1f,
            ),
            matrix,
            1e-6f,
        )
    }

    @Test
    fun `SDR at neutral settings is exactly the confirmed matrix`() {
        // Typical scene, strength 1, no local detail, and colours the protections leave
        // alone (bright, moderately saturated, far from skin): nothing may move.
        listOf(
            floatArrayOf(0.5f, 0.5f, 0.5f),
            floatArrayOf(0.35f, 0.5f, 0.6f),
            floatArrayOf(0.3f, 0.6f, 0.4f),
            floatArrayOf(MID_GREY_FRACTION, MID_GREY_FRACTION, MID_GREY_FRACTION),
        ).forEach { c ->
            val (er, eg, eb) = apply(matrix, c[0], c[1], c[2])
            val out = sdr(c[0], c[1], c[2])
            assertArrayEquals("pixel ${c.toList()}", floatArrayOf(er, eg, eb), out, 2e-4f)
        }
    }

    @Test
    fun `SDR strength zero is a no-op`() {
        val c = floatArrayOf(0.7f, 0.3f, 0.2f)
        assertArrayEquals(c, sdr(c[0], c[1], c[2], strength = 0f), 1e-6f)
    }

    @Test
    fun `SDR saturation actually increases colour separation`() {
        val (r, g, _) = sdr(0.2f, 0.5f, 0.3f)
        assertTrue("expected green to pull away from red", (g - r) > (0.5f - 0.2f))
    }

    @Test
    fun `SDR dark scenes stop losing their shadows to contrast`() {
        // The confirmed 0.18 pivot darkens 0.05 by 18%: harmless in a typical frame, but a dark
        // scene sits almost entirely below the pivot. The adaptive pivot follows the scene down.
        val v = 0.05f
        val typical = sdr(v, v, v)[1]
        val dark = sdr(v, v, v, key = 0.08f)[1]
        assertTrue("typical scene keeps the confirmed contrast, got $typical", typical < v * 0.85f)
        assertTrue("dark scene must keep its shadows within 3%, got $dark", dark >= v * 0.97f)
    }

    @Test
    fun `SDR skin keeps more of its natural colour than other hues`() {
        val skin = floatArrayOf(0.878f, 0.675f, 0.412f)    // sRGB (224, 172, 105)
        val sky = floatArrayOf(0.412f, 0.675f, 0.878f)     // the same, mirrored to blue
        val skinGain = sdrChromaGain(skin)
        val skyGain = sdrChromaGain(sky)
        assertTrue("skin should still gain some colour, got $skinGain", skinGain > 1.02f)
        assertTrue("skin $skinGain must gain less than sky $skyGain", skinGain < skyGain - 0.05f)
    }

    @Test
    fun `SDR vibrance boosts muted colours more than ones already at the edge`() {
        val muted = sdrChromaGain(floatArrayOf(0.4f, 0.55f, 0.5f))
        val vivid = sdrChromaGain(floatArrayOf(0.05f, 0.7f, 0.2f))
        assertTrue("vivid $vivid must gain less than muted $muted", vivid < muted - 0.05f)
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
            val out = hdr(v[0], v[1], v[2], strength = 0f)
            for (c in 0..2) {
                assertEquals("channel $c of ${nits.toList()}", v[c].toDouble(), out[c].toDouble(), v[c] * 1e-3)
            }
        }
    }

    @Test
    fun `HDR near-black is preserved within a few percent, in every kind of scene`() {
        // The defect this path exists to fix. The matrix it replaced took 0.01 nits to 0.0046
        // (-54%) and everything under 0.006 nits to pure black. Dark scenes open their
        // midtones, and must still leave the toe alone -- lifting it is what shows noise.
        listOf(0.05f, 0.12f, 0.25f, 0.4f, 0.6f).forEach { key ->
            listOf(0.01f, 0.02f, 0.05f, 0.1f, 0.2f, 0.5f).forEach { nits ->
                val change = hdrNits(nits, key) / nits - 1f
                assertTrue("key $key: $nits nits changed by ${change * 100}%", abs(change) <= 0.03f)
            }
        }
    }

    @Test
    fun `HDR black stays black`() {
        hdr(0f, 0f, 0f).forEach { assertEquals(0.0, it.toDouble(), 1e-9) }
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
    }

    @Test
    fun `HDR dark scenes open their midtones`() {
        // A night scene's lit areas sit at 1-30 nits; the typical curve barely touches them.
        listOf(3f, 9f, 27f).forEach { nits ->
            val dark = hdrNits(nits, key = 0.12f) / nits - 1f
            val typical = hdrNits(nits) / nits - 1f
            assertTrue("$nits nits: dark scene should lift >=10%, got ${dark * 100}%", dark >= 0.10f)
            assertTrue("$nits nits: and more than a typical scene", dark > typical + 0.03f)
        }
    }

    @Test
    fun `HDR bright scenes lift less, protecting highlights`() {
        assertTrue(hdrNits(81f, key = 0.6f) < hdrNits(81f) - 1f)
    }

    @Test
    fun `HDR curve is monotonic and never darkens, for every scene and strength`() {
        listOf(0f, 0.12f, 0.25f, 0.4f, 0.6f, 1f).forEach { key ->
            listOf(0.5f, 1f, STRENGTH_MAX).forEach { strength ->
                var previous = -1f
                for (step in 0..2000) {
                    val i = step / 2000f
                    val out = hdrCurve(i, key, strength)
                    assertTrue("key $key strength $strength: not monotonic at I=$i", out > previous)
                    if (i < ColorEnhancement.HDR_SHOULDER_I) {
                        assertTrue("key $key strength $strength: darkened at I=$i", out >= i - 1e-6f)
                    }
                    previous = out
                }
            }
        }
    }

    @Test
    fun `HDR saturation is the same at 3 nits and 1000, and keeps hue`() {
        // Scaling Ct/Cp is perceptually uniform; a linear-light saturation is not. A muted,
        // non-skin colour gets exactly SATURATION_HDR at both ends, hue untouched.
        listOf(3f, 1000f).forEach { nits ->
            val v = working(nits, 0.8f, 1f, 1.2f)
            val (_, ct, cp) = toIctcp(v[0], v[1], v[2])
            val (r, g, b) = hdr(v[0], v[1], v[2])
            val (_, ct2, cp2) = toIctcp(r, g, b)
            assertEquals("chroma at $nits nits", SATURATION_HDR.toDouble(), hypot(ct2, cp2) / hypot(ct, cp).toDouble(), 1e-3)
            assertEquals("hue at $nits nits", atan2(cp, ct).toDouble(), atan2(cp2, ct2).toDouble(), 1e-3)
        }
    }

    @Test
    fun `HDR skin keeps more of its natural colour than other hues`() {
        // Linear BT.2020 at ~100 nits for sRGB (224, 172, 105), and the same mirrored to blue.
        val skin = working(100f, 0.62f, 0.42f, 0.17f)
        val sky = working(100f, 0.17f, 0.42f, 0.62f)
        val skinGain = hdrChromaGain(skin)
        val skyGain = hdrChromaGain(sky)
        assertTrue("skin should still gain some colour, got $skinGain", skinGain > 1.01f)
        assertTrue("skin $skinGain must gain less than sky $skyGain", skinGain < skyGain - 0.03f)
    }

    @Test
    fun `HDR deep shadows get less colour boost than midtones`() {
        // Chroma noise lives in the shadows; boosting it is what made the VLC path grainy.
        val deep = hdrChromaGain(working(0.2f, 0.8f, 1f, 1.2f))
        val mid = hdrChromaGain(working(50f, 0.8f, 1f, 1.2f))
        assertTrue("deep $deep must gain less than mid $mid", deep < mid - 0.03f)
    }

    @Test
    fun `HDR static metadata becomes EGL mastering attributes`() {
        // BT.2020 primaries, D65, 1000-nit master, MaxCLL 1000, MaxFALL 400 -- media3's layout.
        val info = ByteBuffer.allocate(25).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(0)
            listOf(0.708f, 0.292f, 0.170f, 0.797f, 0.131f, 0.046f, 0.3127f, 0.3290f)
                .forEach { putShort((it * 50000 + 0.5f).toInt().toShort()) }
            putShort(1000); putShort(0); putShort(1000); putShort(400)
        }.array()
        val attribs = eglHdrMetadata(info)!!.toList().chunked(2).associate { it[0] to it[1] }
        assertEquals(35400, attribs[ColorEnhancement.EGL_SMPTE2086_DISPLAY_PRIMARY_RX])
        assertEquals(16450, attribs[ColorEnhancement.EGL_SMPTE2086_DISPLAY_PRIMARY_RX + 7])   // white y
        assertEquals(1000 * 50000, attribs[ColorEnhancement.EGL_SMPTE2086_MAX_LUMINANCE])
        assertEquals(1000 * 50000, attribs[ColorEnhancement.EGL_CTA861_3_MAX_CONTENT_LIGHT_LEVEL])
        assertEquals(400 * 50000, attribs[ColorEnhancement.EGL_CTA861_3_MAX_FRAME_AVERAGE_LEVEL])

        assertNull(eglHdrMetadata(null))
        assertNull("no mastering luminance, nothing worth sending", eglHdrMetadata(ByteArray(25)))
    }

    @Test
    fun `media3 shader overrides match the media3 version in use`() {
        // res/raw replaces two media3 shaders to fix fp16 black crush. A stale copy after a
        // media3 upgrade would silently run old shader code against new uniforms.
        val media3 = Regex("""media3-effect:([\d.]+)""").find(File("build.gradle").readText())!!.groupValues[1]
        listOf("fragment_shader_transformation_external_yuv_es3", "fragment_shader_oetf_es3").forEach {
            val glsl = File("src/main/res/raw/$it.glsl").readText()
            assertTrue("$it must be re-copied from media3 $media3", "override of media3 $media3:" in glsl)
            assertTrue("$it must use highp", "precision highp float;" in glsl && "precision mediump" !in glsl)
        }
    }

    @Test
    fun `enhancement is per pixel, so it cannot draw halos`() {
        // Clarity -- boosting a pixel against its blurred neighbourhood -- put a visible shadow
        // around people against bright windows (The Boys S05E04, 19:35) and was removed. The
        // main pass may read only its own pixel (plus debanding's flat-area taps) and the key.
        listOf(ColorEnhancement.fragmentShader(true), ColorEnhancement.fragmentShader(false)).forEach {
            assertTrue("main pass must not sample the luma pyramid", "uStats" !in it)
        }
    }

    @Test
    fun `generated shaders contain every constant as a valid GLSL literal`() {
        // Numbers are spliced in from Kotlin; a NaN, an Infinity or a bare integer would only
        // fail on the device, at shader compile.
        listOf(
            ColorEnhancement.fragmentShader(true), ColorEnhancement.fragmentShader(false),
            ColorEnhancement.statsShader(true), ColorEnhancement.statsShader(false),
            ColorEnhancement.STATE_SHADER,
        ).forEach { source ->
            assertTrue(source.startsWith("#version 300 es"))
            val glsl = source.lines().joinToString("\n") { it.substringBefore("//") }
            assertTrue("NaN or Infinity in shader", "NaN" !in glsl && "Infinity" !in glsl)
            assertTrue("unexpanded template in shader", "\${" !in glsl)
        }
    }
}
