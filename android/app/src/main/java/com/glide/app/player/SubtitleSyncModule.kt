package com.glide.app.player

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.File
import kotlin.concurrent.thread

/** JS bridge for [SubtitleAligner]. The audio clip comes from JS's existing FFmpeg extraction. */
class SubtitleSyncModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

    override fun getName() = "SubtitleSyncModule"

    /**
     * Align cue times (seconds) against the speech in [wavPath], a 16-bit PCM WAV (any channel count) whose first
     * sample is at [windowStartS]. Resolves null when there is too little to go on.
     */
    @ReactMethod
    fun align(wavPath: String, windowStartS: Double, starts: ReadableArray, ends: ReadableArray, promise: Promise) {
        // Off the JS and UI threads: a 5-minute clip is ~10 MB of PCM.
        thread(name = "subtitle-align") {
            try {
                val wav = SubtitleAligner.pcmFromWav(File(wavPath).readBytes())
                    ?: return@thread promise.reject("E_WAV", "Not a 16-bit PCM WAV")
                val s = DoubleArray(starts.size()) { starts.getDouble(it) }
                val e = DoubleArray(ends.size()) { ends.getDouble(it) }
                // The centre channel: measured on The Boys S05E04, z 7.9 against 5.3 for a mono
                // downmix, where music and effects from the other channels bury the dialogue.
                val result = SubtitleAligner.align(
                    SubtitleAligner.speechLevels(wav.dialogue(), wav.sampleRate), windowStartS, s, e,
                ) ?: return@thread promise.resolve(null)
                promise.resolve(Arguments.createMap().apply {
                    putDouble("delayMs", result.delayS * 1000)
                    putDouble("ratio", result.ratio)
                    putDouble("peakZ", result.peakZ)
                    putDouble("runnerUp", result.runnerUp)
                    putBoolean("confident", result.confident)
                    putBoolean("drift", result.drift)
                })
            } catch (e: Exception) {
                promise.reject("E_ALIGN", e)
            }
        }
    }
}
