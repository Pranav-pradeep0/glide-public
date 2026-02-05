package com.glide.app.orientation

import android.content.res.Configuration
import android.content.pm.ActivityInfo
import com.facebook.react.bridge.*

class VideoOrientationModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String {
        return "VideoOrientation"
    }

    @ReactMethod
    fun lockToPortrait() {
        val activity = currentActivity
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }

    @ReactMethod
    fun lockToLandscape() {
        val activity = currentActivity
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }

    @ReactMethod
    fun enableAuto() {
        // Use system FULL_SENSOR. 
        // This allows all 4 orientations (if device supports) and respects the user holding the device 
        // *even if* system auto-rotate is off (because we are enforcing it for this activity).
        // It also handles the "initial state" correctly without delay.
        val activity = currentActivity
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
    }

    @ReactMethod
    fun disableAuto() {
        // To "lock" the current orientation, we check the configuration and set
        // a specific orientation to freeze the current state.
        val activity = currentActivity ?: return
        
        val configuration = activity.resources.configuration
        
        if (configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE) {
             // Lock to SENSOR_LANDSCAPE to allow 180-degree flips while staying horizontal
             activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
             activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }

    @ReactMethod
    fun release() {
        releaseInternal()
    }

    /**
     * Internal release with "Portrait Snap".
     * Explicitly sets portrait first to force the OS to re-evaluate layout, 
     * then resets to UNSPECIFIED.
     */
    private fun releaseInternal() {
        val activity = currentActivity ?: return
        activity.runOnUiThread {
            try {
                // Phase 1: Force Portrait to snap the UI back immediately
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                
                // Phase 2: Release to system (delayed slightly to ensure OS registers Phase 1)
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                }, 100)
            } catch (e: Exception) {
                // Fallback: just reset
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }
    }

    override fun onHostResume() {}

    override fun onHostPause() {
        // Do NOT release orientation on pause - the user may just be switching apps briefly
        // and expects to return to the same orientation state.
        // Only onHostDestroy should release the orientation.
    }

    override fun onHostDestroy() {
        releaseInternal()
    }
}
