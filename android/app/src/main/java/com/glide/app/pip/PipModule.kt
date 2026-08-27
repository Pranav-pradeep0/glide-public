package com.glide.app.pip

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Reports Picture-in-Picture state to JavaScript.
 *
 * PiP itself is owned natively by the video view (see VlcPipController in the VLC
 * player module), because that is the only place that knows the video's dimensions,
 * the surface bounds and whether playback is live. This module is only the event
 * channel that lets the React tree react to a mode change, plus the one activity
 * action the external-open flow needs.
 *
 * It deliberately holds no PiP configuration. The previous version tracked aspect
 * ratio, source rect, auto-enter and a per-activity ownership map pushed down from
 * JS; clearing that state never reached the Activity, so auto-enter stayed armed
 * after the player was gone and Android would put an unrelated screen into PiP.
 */
class PipModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "PipModule"
        const val PIP_MODE_CHANGED_EVENT = "onPipModeChanged"
    }

    override fun getName(): String = NAME

    /** Required by RN's built-in NativeEventEmitter. */
    @ReactMethod
    fun addListener(eventName: String) = Unit

    /** Required by RN's built-in NativeEventEmitter. */
    @ReactMethod
    fun removeListeners(count: Int) = Unit

    @ReactMethod
    fun isInPipMode(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        promise.resolve(activity != null && activity.isInPictureInPictureMode)
    }

    @ReactMethod
    fun isPipSupported(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }

        promise.resolve(
            activity.packageManager.hasSystemFeature(
                android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE
            )
        )
    }

    /**
     * Close the Activity hosting the player. Used when playback was opened from
     * outside the app, where going "back" should dismiss this Activity rather than
     * exit the whole process.
     */
    @ReactMethod
    fun finishCurrentActivity(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }

        activity.finish()
        promise.resolve(true)
    }

    /** Called from the host Activity's onPictureInPictureModeChanged. */
    fun onPictureInPictureModeChanged(isInPipMode: Boolean) {
        val params = Arguments.createMap().apply {
            putBoolean("isInPipMode", isInPipMode)
        }
        sendEvent(PIP_MODE_CHANGED_EVENT, params)
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(eventName, params)
        } catch (e: Exception) {
            android.util.Log.w(NAME, "Failed to emit $eventName: ${e.message}")
        }
    }
}
