package com.glide.app.player

import android.content.Context
import android.opengl.EGL14
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.opengl.GLES30
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import androidx.media3.effect.RgbMatrix
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Colour enhancement as one GL effect for SDR and HDR -- the maths is [ColorEnhancement].
 *
 * Per frame, three draws: the frame downsampled to [ColorEnhancement.STATS_WIDTH] columns of
 * perceptual luma and mipmapped (the mean drives the scene-adaptive curve, a mid mip is the
 * blur behind clarity), a 1x1 pass easing the scene key between two ping-pong textures, then
 * the enhancement itself. Everything stays on the GPU: reading the key back would stall the
 * pipeline every frame.
 *
 * [strength] and [hdrMetadata] are read per frame, so the slider applies live without the
 * re-open that arming the effect needs.
 */
@UnstableApi
internal class ColorEnhancementEffect : GlEffect {

    /** 0..[ColorEnhancement.STRENGTH_MAX]; 1 is the tuned look. */
    @Volatile var strength = 1f

    /** EGL attribute/value pairs from [ColorEnhancement.eglHdrMetadata], or null. */
    @Volatile var hdrMetadata: IntArray? = null

    // ES 2 context, or no half-float render targets: the confirmed SDR matrix, as before.
    // ponytail: the fallback ignores strength; nothing we ship has hit it.
    private val sdrFallback = RgbMatrix { _, _ -> ColorEnhancement.sdrMatrix() }

    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram {
        // media3 guarantees ES 3 and RGBA16F targets for HDR; for SDR it may fall back to ES 2.
        if (!useHdr && !shadersSupported()) {
            Log.w(GlidePlayerView.TAG, "enhancement: GL lacks ES 3 / half-float targets, SDR matrix only")
            return sdrFallback.toGlShaderProgram(context, false)
        }
        return Program(useHdr)
    }

    private fun shadersSupported(): Boolean {
        val version = GLES20.glGetString(GLES20.GL_VERSION) ?: return false
        val extensions = GLES20.glGetString(GLES20.GL_EXTENSIONS) ?: ""
        return "OpenGL ES 3" in version &&
            ("GL_EXT_color_buffer_half_float" in extensions || "GL_EXT_color_buffer_float" in extensions)
    }

    private inner class Program(private val hdr: Boolean) :
        BaseGlShaderProgram(/* useHighPrecisionColorComponents= */ hdr, /* texturePoolCapacity= */ 1) {

        private val main = program(ColorEnhancement.fragmentShader(hdr))
        private val stats = program(ColorEnhancement.statsShader(hdr))
        private val state = program(ColorEnhancement.STATE_SHADER)

        private var statsTex = 0
        private var statsFbo = 0
        private var statsWidth = 0
        private var statsHeight = 0
        private val stateTex = IntArray(2)
        private val stateFbo = IntArray(2)
        private var current = 0

        private var lastPtsUs = C.TIME_UNSET
        private var reset = true
        private var taggedSurface: EGLSurface? = null
        private var taggedMetadata: IntArray? = null

        override fun configure(inputWidth: Int, inputHeight: Int): Size {
            try {
                deleteTargets()
                statsWidth = ColorEnhancement.STATS_WIDTH
                statsHeight = max(1, (statsWidth.toFloat() * inputHeight / inputWidth).roundToInt())
                // Always half-float: an 8-bit key could not ease by less than 1/255 a frame.
                statsTex = GlUtil.createTexture(statsWidth, statsHeight, true)
                GlUtil.bindTexture(GLES20.GL_TEXTURE_2D, statsTex, GLES20.GL_LINEAR)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR_MIPMAP_LINEAR)
                statsFbo = GlUtil.createFboForTexture(statsTex)
                for (k in 0..1) {
                    stateTex[k] = GlUtil.createTexture(1, 1, true)
                    stateFbo[k] = GlUtil.createFboForTexture(stateTex[k])
                }
            } catch (e: GlUtil.GlException) {
                throw VideoFrameProcessingException(e)
            }
            stats.setFloatsUniform("uFootprint", floatArrayOf(1f / statsWidth, 1f / statsHeight))
            val level = 2f.pow(ColorEnhancement.CLARITY_LEVEL)
            main.setFloatsUniform("uClarityTexel", floatArrayOf(level / statsWidth, level / statsHeight))
            val radius = ColorEnhancement.DEBAND_RADIUS_1080 * inputHeight / 1080f
            main.setFloatsUniformIfPresent("uDebandStep", floatArrayOf(radius / inputWidth, radius / inputHeight))
            reset = true
            return Size(inputWidth, inputHeight)
        }

        override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
            try {
                val outputFbo = IntArray(1).also { GLES20.glGetIntegerv(GLES20.GL_FRAMEBUFFER_BINDING, it, 0) }
                val viewport = IntArray(4).also { GLES20.glGetIntegerv(GLES20.GL_VIEWPORT, it, 0) }

                // 1. The frame as perceptual luma, then mipmapped down to its mean.
                GlUtil.focusFramebufferUsingCurrentContext(statsFbo, statsWidth, statsHeight)
                stats.use()
                stats.setSamplerTexIdUniform("uTex", inputTexId, 0)
                stats.bindAttributesAndUniforms()
                drawQuad()
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, statsTex)
                GLES30.glGenerateMipmap(GLES20.GL_TEXTURE_2D)

                // 2. Ease the scene key; snap after a seek, a gap or a reconfigure.
                val dtS = (presentationTimeUs - lastPtsUs) / 1e6f
                val alpha = if (reset || lastPtsUs == C.TIME_UNSET || dtS <= 0f || dtS > 1f) 1f
                    else 1f - exp(-dtS / ColorEnhancement.SCENE_TAU_S)
                reset = false
                lastPtsUs = presentationTimeUs
                val next = 1 - current
                GlUtil.focusFramebufferUsingCurrentContext(stateFbo[next], 1, 1)
                state.use()
                state.setSamplerTexIdUniform("uStats", statsTex, 0)
                state.setSamplerTexIdUniform("uPrev", stateTex[current], 1)
                state.setFloatUniform("uAlpha", alpha)
                state.bindAttributesAndUniforms()
                drawQuad()
                current = next

                // 3. The enhancement, into the output BaseGlShaderProgram focused for us.
                GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, outputFbo[0])
                GLES20.glViewport(viewport[0], viewport[1], viewport[2], viewport[3])
                main.use()
                main.setSamplerTexIdUniform("uTex", inputTexId, 0)
                main.setSamplerTexIdUniform("uStats", statsTex, 1)
                main.setSamplerTexIdUniform("uState", stateTex[current], 2)
                main.setFloatUniform("uStrength", strength.coerceIn(0f, ColorEnhancement.STRENGTH_MAX))
                main.bindAttributesAndUniforms()
                drawQuad()

                if (hdr) tagOutputSurface()
            } catch (e: GlUtil.GlException) {
                throw VideoFrameProcessingException(e, presentationTimeUs)
            }
        }

        override fun flush() {
            reset = true
            super.flush()
        }

        /**
         * Give the display the video's mastering metadata, which media3 never sets on the
         * surface it renders to. The output window is the current EGL surface here from the
         * second frame on: media3's final pass focuses it and nothing switches back.
         */
        private fun tagOutputSurface() {
            val attribs = hdrMetadata ?: return
            val display = EGL14.eglGetCurrentDisplay()
            val surface = EGL14.eglGetCurrentSurface(EGL14.EGL_DRAW)
            if (surface == EGL14.EGL_NO_SURFACE || (surface == taggedSurface && attribs === taggedMetadata)) return
            val width = IntArray(1)
            EGL14.eglQuerySurface(display, surface, EGL14.EGL_WIDTH, width, 0)
            if (width[0] <= 1) return   // media3's placeholder, not the window
            var ok = true
            for (k in attribs.indices step 2) {
                ok = EGL14.eglSurfaceAttrib(display, surface, attribs[k], attribs[k + 1]) && ok
            }
            taggedSurface = surface
            taggedMetadata = attribs
            Log.w(GlidePlayerView.TAG, "HDR mastering metadata on output surface: ok=$ok " +
                "maxNits=${attribs[attribs.indexOf(ColorEnhancement.EGL_SMPTE2086_MAX_LUMINANCE) + 1] /
                    ColorEnhancement.EGL_METADATA_SCALING}")
        }

        override fun release() {
            super.release()
            try {
                main.delete()
                stats.delete()
                state.delete()
                deleteTargets()
            } catch (e: GlUtil.GlException) {
                throw VideoFrameProcessingException(e)
            }
        }

        private fun deleteTargets() {
            if (statsTex == 0) return
            GlUtil.deleteFbo(statsFbo)
            GlUtil.deleteTexture(statsTex)
            for (k in 0..1) {
                GlUtil.deleteFbo(stateFbo[k])
                GlUtil.deleteTexture(stateTex[k])
            }
            statsTex = 0
        }
    }

    private fun program(fragmentShader: String) = try {
        GlProgram(ColorEnhancement.VERTEX_SHADER, fragmentShader).apply {
            setBufferAttribute(
                "aFramePosition",
                GlUtil.getNormalizedCoordinateBounds(),
                GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE,
            )
        }
    } catch (e: GlUtil.GlException) {
        throw VideoFrameProcessingException(e)
    }

    /** The four-vertex triangle strip is the full-frame quad. */
    private fun drawQuad() = GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
}
