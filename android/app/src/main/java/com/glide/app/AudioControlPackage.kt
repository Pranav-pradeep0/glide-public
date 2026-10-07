package com.glide.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.glide.app.audio.AudioVolumeModule
import com.glide.app.brightness.DisplayBrightnessModule

/**
 * React Native package for audio volume, display brightness, and legacy compatibility.
 */
class AudioControlPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        val audioVolumeModule = AudioVolumeModule(reactContext)
        val displayBrightnessModule = DisplayBrightnessModule(reactContext)
        val legacyAudioControlModule = AudioControlModule(
            reactContext,
            audioVolumeModule,
            displayBrightnessModule
        )

        return listOf(
            audioVolumeModule,
            displayBrightnessModule,
            legacyAudioControlModule
        )
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
