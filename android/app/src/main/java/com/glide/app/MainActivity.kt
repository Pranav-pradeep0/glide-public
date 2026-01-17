package com.glide.app

import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.bridge.ReactContext
import com.glide.app.pip.PipModule

class MainActivity : ReactActivity() {

  /**
   * Reset theme from SplashTheme to AppTheme once React Native loads
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Glide"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Handle new intent when app is already running (singleTask mode)
   * This ensures Linking.getInitialURL() returns the correct URI for video files
   */
  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
  }

  /**
   * Called when the activity enters or exits PIP mode
   */
  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    
    // Notify the React Native module about PIP state change
    try {
      val reactApplication = application as? com.facebook.react.ReactApplication
      val reactContext = reactApplication?.reactNativeHost?.reactInstanceManager?.currentReactContext
      if (reactContext != null) {
        val pipModule = reactContext.getNativeModule(PipModule::class.java)
        pipModule?.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
      }
    } catch (e: Exception) {
      // Silently ignore - PIP mode will still work, just without event notification
      android.util.Log.w("MainActivity", "Failed to notify PIP state change: ${e.message}")
    }
  }
}
