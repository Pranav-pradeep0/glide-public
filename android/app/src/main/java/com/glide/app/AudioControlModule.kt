package com.glide.app

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.glide.app.audio.AudioVolumeModule
import com.glide.app.brightness.DisplayBrightnessModule

/**
 * Unified Audio Control Module for Glide (Deprecated).
 *
 * @deprecated Deprecated in favor of [AudioVolumeModule] and [DisplayBrightnessModule].
 * Retained for backwards compatibility with legacy JS callers and native player checks.
 */
@Deprecated("Use AudioVolumeModule and DisplayBrightnessModule instead")
@ReactModule(name = AudioControlModule.MODULE_NAME)
class AudioControlModule(
    reactContext: ReactApplicationContext,
    private val audioVolumeModule: AudioVolumeModule? = null,
    private val displayBrightnessModule: DisplayBrightnessModule? = null
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val MODULE_NAME = "AudioControlModule"

        @Volatile
        private var instance: AudioControlModule? = null

        @JvmStatic
        fun getInstance(): AudioControlModule? = instance
    }

    private val volumeModule: AudioVolumeModule by lazy {
        audioVolumeModule ?: AudioVolumeModule(reactContext)
    }

    private val brightnessModule: DisplayBrightnessModule by lazy {
        displayBrightnessModule ?: DisplayBrightnessModule(reactContext)
    }

    init {
        instance = this
    }

    override fun getName(): String = MODULE_NAME

    val isListening: Boolean
        get() = volumeModule.isListening

    fun isOnSpeaker(): Boolean = volumeModule.isOnSpeaker()

    fun handleVolumeKey(keyCode: Int): Boolean = volumeModule.handleVolumeKey(keyCode)

    @ReactMethod
    fun setVolume(percentage: Int, promise: Promise) {
        volumeModule.setVolume(percentage, promise)
    }

    @ReactMethod
    fun setVolumeSync(percentage: Int) {
        volumeModule.setVolumeSync(percentage)
    }

    @ReactMethod
    fun getVolume(promise: Promise) {
        volumeModule.getVolume(promise)
    }

    @ReactMethod
    fun getCurrentRoute(promise: Promise) {
        volumeModule.getCurrentRoute(promise)
    }

    @ReactMethod
    fun startListening() {
        volumeModule.startListening()
    }

    @ReactMethod
    fun stopListening() {
        volumeModule.stopListening()
        brightnessModule.resetBrightnessSync()
    }

    @ReactMethod
    fun setBrightness(brightness: Float, promise: Promise) {
        brightnessModule.setBrightness(brightness)
        promise.resolve(brightness.coerceIn(0.0f, 1.0f))
    }

    @ReactMethod
    fun setBrightnessSync(brightness: Float) {
        brightnessModule.setBrightness(brightness)
    }

    @ReactMethod
    fun getBrightness(promise: Promise) {
        brightnessModule.getBrightness(promise)
    }

    @ReactMethod
    fun resetBrightness(promise: Promise) {
        brightnessModule.resetBrightness(promise)
    }

    @ReactMethod
    fun resetBrightnessSync() {
        brightnessModule.resetBrightnessSync()
    }

    override fun invalidate() {
        super.invalidate()
        if (instance === this) {
            instance = null
        }
    }
}
