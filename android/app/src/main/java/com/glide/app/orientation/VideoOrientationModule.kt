package com.glide.app.orientation

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import com.facebook.react.bridge.*

class VideoOrientationModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

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
        // To "lock" the current orientation, we ask the system what the configuration is right now,
        // and then explicitly set that as the requested orientation.
        val activity = currentActivity ?: return
        
        val configuration = activity.resources.configuration
        val rotation = activity.windowManager.defaultDisplay.rotation
        
        // Map current rotation to specific orientation to "freeze" it exactly as is
        // (android.view.Surface.ROTATION_0 etc used naturally by mapping logic if needed, 
        // but simpler is checking configuration orientation)
        
        if (configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE) {
             // It could be normal landscape or reverse landscape.
             // A simple lock to SENSOR_LANDSCAPE keeps it horizontal but allows 180 flips,
             // or strictly LANDSCAPE locks it to one side.
             // Usually "Lock" means "don't change at all". 
             // Let's rely on standard LANDSCAPE for now, or if we want exact current:
             // We can check rotation.
             
             // For simplicity and user expectation: "Lock" usually just means "Stop rotating automatically".
             // If I am in Landscape, keep me in Landscape.
             activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
             activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }

    @ReactMethod
    fun release() {
        val activity = currentActivity
        // Reset to UNSPECIFIED to let the system decide (usually means following system settings)
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
}
