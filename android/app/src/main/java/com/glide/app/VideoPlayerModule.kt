package com.glide.app

import android.content.Intent
import com.facebook.react.bridge.*

class VideoPlayerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "VideoPlayerModule"
    }

    @ReactMethod
    fun startPlayer(options: ReadableMap) {
        val context = reactApplicationContext
        val intent = Intent(context, VideoPlayerActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            
            // Modern 2026 approach: Convert the entire ReadableMap to a Bundle
            // This handles nested maps, arrays, and all types automatically.
            val bundle = Arguments.toBundle(options)
            if (bundle != null) {
                putExtras(bundle)
            }
        }
        context.startActivity(intent)
    }

    @ReactMethod
    fun closePlayer() {
        currentActivity?.finish()
    }
}
