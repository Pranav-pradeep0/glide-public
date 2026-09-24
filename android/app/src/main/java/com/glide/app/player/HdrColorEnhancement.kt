package com.glide.app.player

import android.content.Context
import android.opengl.GLES20
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import androidx.media3.effect.PassthroughShaderProgram

/**
 * HDR colour enhancement as its own GL pass, doing [ColorEnhancement.hdr] per pixel.
 *
 * SDR gets a [PassthroughShaderProgram], which forwards the texture without drawing, so SDR
 * stays on the `RgbMatrix` exactly as before. That is also why this effect has to come
 * *before* the matrix in the list: media3 folds only trailing matrices into its final pass,
 * which is where the SDR matrix has always run.
 *
 * Cost, HDR only: one extra full-frame RGBA16F pass and 12 `pow` per pixel, on top of the
 * 12 media3's input and output passes already spend.
 */
@UnstableApi
internal object HdrColorEnhancement : GlEffect {

    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        if (useHdr) Program(useHdr) else PassthroughShaderProgram()

    private class Program(useHdr: Boolean) :
        BaseGlShaderProgram(/* useHighPrecisionColorComponents= */ useHdr, /* texturePoolCapacity= */ 1) {

        private val glProgram = try {
            GlProgram(VERTEX_SHADER, ColorEnhancement.HDR_FRAGMENT_SHADER).apply {
                setBufferAttribute(
                    "aFramePosition",
                    GlUtil.getNormalizedCoordinateBounds(),
                    GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE,
                )
                setFloatsUniform("uRgbToLms", columnMajor(ColorEnhancement.RGB_TO_LMS))
                setFloatsUniform("uLmsToIctcp", columnMajor(ColorEnhancement.LMS_TO_ICTCP))
                setFloatsUniform("uIctcpToLms", columnMajor(ColorEnhancement.ICTCP_TO_LMS))
                setFloatsUniform("uLmsToRgb", columnMajor(ColorEnhancement.LMS_TO_RGB))
                setFloatUniform("uWorkingToPq", ColorEnhancement.WORKING_TO_PQ)
                setFloatUniform("uLift", ColorEnhancement.HDR_LIFT)
                setFloatUniform("uShoulder", ColorEnhancement.HDR_SHOULDER_I)
                setFloatUniform("uSaturation", ColorEnhancement.SATURATION_HDR)
            }
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e)
        }

        override fun configure(inputWidth: Int, inputHeight: Int) = Size(inputWidth, inputHeight)

        override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
            try {
                glProgram.use()
                glProgram.setSamplerTexIdUniform("uTexSampler", inputTexId, /* texUnitIndex= */ 0)
                glProgram.bindAttributesAndUniforms()
                // The four-vertex triangle strip is the full-frame quad.
                GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            } catch (e: GlUtil.GlException) {
                throw VideoFrameProcessingException(e, presentationTimeUs)
            }
        }

        override fun release() {
            super.release()
            try {
                glProgram.delete()
            } catch (e: GlUtil.GlException) {
                throw VideoFrameProcessingException(e)
            }
        }
    }

    private const val VERTEX_SHADER = """#version 300 es
in vec4 aFramePosition;
out vec2 vTexSamplingCoord;
void main() {
  gl_Position = aFramePosition;
  vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5;
}
"""

    private fun columnMajor(m: FloatArray) =
        floatArrayOf(m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8])
}
