package com.glide.app

import android.content.res.Configuration
import android.content.pm.ActivityInfo
import android.os.Build
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.os.Bundle
import android.content.Intent
import com.glide.app.pip.PipModule

class VideoPlayerActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "VideoPlayerActivity"

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set orientation before super.onCreate so OEMs can settle during the transition.
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
    super.onCreate(savedInstanceState)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
      override fun getLaunchOptions(): Bundle? {
          val initialProps = Bundle()
          
          // Handle ACTION_VIEW (direct open)
          intent?.data?.toString()?.let { uri ->
              initialProps.putString("videoUri", uri)
          }

          // Handle ACTION_SEND (share menu)
          if (intent?.action == Intent.ACTION_SEND && intent?.type?.startsWith("video/") == true) {
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                  intent?.getParcelableExtra(Intent.EXTRA_STREAM, android.net.Uri::class.java)
              } else {
                  @Suppress("DEPRECATION")
                  intent?.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM)
              }?.let { uri ->
                  initialProps.putString("videoUri", uri.toString())
              }
          }

          return initialProps
      }
      }

  /**
   * PiP is owned natively by the video view; the Activity only relays the mode change
   * so the React tree can hide what does not belong in a PiP window.
   */
  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)

    try {
      val reactApplication = application as? com.facebook.react.ReactApplication
      val reactContext = reactApplication?.reactHost?.currentReactContext
      reactContext?.getNativeModule(PipModule::class.java)
          ?.onPictureInPictureModeChanged(isInPictureInPictureMode)
    } catch (e: Exception) {
      android.util.Log.w("VideoPlayerActivity", "Failed to notify PIP state change: ${e.message}")
    }
  }
}
