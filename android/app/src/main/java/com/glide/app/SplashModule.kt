package com.glide.app

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SplashModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "SplashModule"

    @ReactMethod
    fun hide() {
        val activity = currentActivity as? MainActivity ?: return
        activity.runOnUiThread {
            activity.onReactReady()
        }
    }
}
