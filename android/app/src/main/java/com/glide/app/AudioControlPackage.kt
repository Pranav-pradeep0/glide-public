package com.glide.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.glide.app.audio.AudioVolumeModule
import com.glide.app.brightness.DisplayBrightnessModule

/**
 * React Native package for audio volume and display brightness.
 */
class AudioControlPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(
            AudioVolumeModule(reactContext),
            DisplayBrightnessModule(reactContext)
        )
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
