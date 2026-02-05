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

import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : ReactActivity() {
  private var isReactReady = false

  override fun onCreate(savedInstanceState: Bundle?) {
    val splashScreen = installSplashScreen()
    // In debug, we only keep it until the activity is created to see bundling progress.
    // In release, we keep it until React Native is ready for a perfect transition.
    splashScreen.setKeepOnScreenCondition { !BuildConfig.DEBUG && !isReactReady }
    super.onCreate(savedInstanceState)
    
    // Programmatically set background to ensure it's applied correctly during debug bundling gap
    window.setBackgroundDrawableResource(R.color.splash_background)
  }

  fun onReactReady() {
    isReactReady = true
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
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
          override fun createRootView(): com.facebook.react.ReactRootView? {
              val rootView = super.createRootView()
              // Ensure the root view has the same background as the splash to prevent black flash
              rootView?.let {
                val color = androidx.core.content.ContextCompat.getColor(this@MainActivity, R.color.splash_background)
                it.setBackgroundColor(color)
              }
              return rootView
          }
      }

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

  /**
   * Intercept hardware volume keys to show in-app volume slider instead of system UI.
   * Only intercepts when the video player is actively listening (AudioControlModule).
   */
  override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent?): Boolean {
    if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP || 
        keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN) {
      
      android.util.Log.d("MainActivity", "Volume key pressed: $keyCode")
      
      try {
        // Use static instance instead of React context lookup (fixes null context issue)
        val audioModule = AudioControlModule.getInstance()
        
        android.util.Log.d("MainActivity", "AudioModule available: ${audioModule != null}")
        android.util.Log.d("MainActivity", "isListening: ${audioModule?.isListeningForVolumeChanges()}")
        
        // Only intercept if AudioControlModule is actively listening (player is open)
        if (audioModule?.isListeningForVolumeChanges() == true) {
          val audioManager = getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
          val maxVolume = audioManager.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
          val currentVolume = audioManager.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)
          
          // Calculate step size (typically 1/15 of max)
          val step = maxOf(1, maxVolume / 15)
          
          val newVolume = if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP) {
            minOf(currentVolume + step, maxVolume)
          } else {
            maxOf(currentVolume - step, 0)
          }
          
          android.util.Log.d("MainActivity", "Setting volume: $currentVolume -> $newVolume (max: $maxVolume)")
          
          // Set volume silently (no system UI)
          audioManager.setStreamVolume(
            android.media.AudioManager.STREAM_MUSIC,
            newVolume,
            0 // No flags = silent update
          )
          
          // Emit event to JS
          audioModule.emitHardwareVolumeChange()
          
          android.util.Log.d("MainActivity", "Volume key intercepted successfully!")
          return true // Consume the event (hide system UI)
        }
      } catch (e: Exception) {
        android.util.Log.e("MainActivity", "Volume key interception failed: ${e.message}", e)
      }
    }
    
    return super.onKeyDown(keyCode, event)
  }
}
