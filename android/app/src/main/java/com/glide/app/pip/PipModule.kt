package com.glide.app.pip

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.res.Configuration
import android.os.Build
import android.util.Rational
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class PipModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "PipModule"
        const val PIP_MODE_CHANGED_EVENT = "onPipModeChanged"
        
        // Store the last known PIP state to avoid duplicate events
        private var lastPipState: Boolean = false
    }

    override fun getName(): String = NAME

    /**
     * Required by NativeEventEmitter - called when adding a listener
     */
    @ReactMethod
    fun addListener(eventName: String) {
        // Keep: Required for RN built-in NativeEventEmitter
    }

    /**
     * Required by NativeEventEmitter - called when removing listeners
     */
    @ReactMethod
    fun removeListeners(count: Int) {
        // Keep: Required for RN built-in NativeEventEmitter
    }

    /**
     * Enter Picture-in-Picture mode with the given aspect ratio.
     * Defaults to 16:9 if not specified.
     */
    @ReactMethod
    fun enterPipMode(aspectRatioWidth: Int?, aspectRatioHeight: Int?, promise: Promise) {
        val activity = currentActivity
        
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No current activity")
            return
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.reject("UNSUPPORTED", "PIP requires Android 8.0 (API 26) or higher")
            return
        }

        try {
            val width = aspectRatioWidth ?: 16
            val height = aspectRatioHeight ?: 9
            
            val params = PictureInPictureParams.Builder()
                .setAspectRatio(Rational(width, height))
                .build()
            
            val entered = activity.enterPictureInPictureMode(params)
            promise.resolve(entered)
        } catch (e: Exception) {
            promise.reject("PIP_ERROR", "Failed to enter PIP mode: ${e.message}", e)
        }
    }

    /**
     * Check if the app is currently in PIP mode.
     */
    @ReactMethod
    fun isInPipMode(promise: Promise) {
        val activity = currentActivity
        
        if (activity == null) {
            promise.resolve(false)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            promise.resolve(activity.isInPictureInPictureMode)
        } else {
            promise.resolve(false)
        }
    }

    /**
     * Check if PIP is supported on this device.
     */
    @ReactMethod
    fun isPipSupported(promise: Promise) {
        val activity = currentActivity
        
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.resolve(false)
            return
        }

        try {
            val packageManager = activity.packageManager
            promise.resolve(packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE))
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Called by the Activity when PIP mode changes.
     * This method is called from Activity.onPictureInPictureModeChanged()
     */
    fun onPictureInPictureModeChanged(isInPipMode: Boolean, newConfig: Configuration?) {
        // Avoid sending duplicate events
        if (lastPipState == isInPipMode) {
            return
        }
        lastPipState = isInPipMode

        try {
            val params = Arguments.createMap().apply {
                putBoolean("isInPipMode", isInPipMode)
            }
            sendEvent(PIP_MODE_CHANGED_EVENT, params)
        } catch (e: Exception) {
            android.util.Log.w("PipModule", "Failed to send PIP event: ${e.message}")
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (!reactApplicationContext.hasActiveCatalystInstance()) {
            return
        }
        
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(eventName, params)
        } catch (e: Exception) {
            android.util.Log.w("PipModule", "Failed to emit event: ${e.message}")
        }
    }
}
