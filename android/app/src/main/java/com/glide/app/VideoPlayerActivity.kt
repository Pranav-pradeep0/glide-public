package com.glide.app

import android.content.res.Configuration
import android.os.Build
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.os.Bundle
import android.content.Intent
import com.glide.app.pip.PipModule
import android.view.KeyEvent

class VideoPlayerActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "VideoPlayerActivity"

  /**
   * Intercept hardware volume keys to show in-app volume slider instead of system UI.
   * Only intercepts when the video player is actively listening (AudioControlModule).
   */
  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || 
        keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
      
      try {
        // Use static instance instead of React context lookup (fixes null context issue)
        val audioModule = AudioControlModule.getInstance()
        
        // Only intercept if AudioControlModule is actively listening (player is open)
        if (audioModule?.isListeningForVolumeChanges() == true) {
          val audioManager = getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
          val maxVolume = audioManager.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
          val currentVolume = audioManager.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)
          
          // Calculate step size (typically 1/15 of max)
          val step = maxOf(1, maxVolume / 15)
          
          val newVolume = if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            minOf(currentVolume + step, maxVolume)
          } else {
            maxOf(currentVolume - step, 0)
          }
          
          // Set volume silently (no system UI)
          audioManager.setStreamVolume(
            android.media.AudioManager.STREAM_MUSIC,
            newVolume,
            0 // No flags = silent update
          )
          
          // Emit event to JS
          audioModule.emitHardwareVolumeChange()
          
          return true // Consume the event (hide system UI)
        }
      } catch (e: Exception) {
        android.util.Log.e("VideoPlayerActivity", "Volume key interception failed: ${e.message}", e)
      }
    }
    
    return super.onKeyDown(keyCode, event)
  }

  /**
   * Reset screen brightness to system default when the activity is destroyed.
   * This prevents brightness from persisting after the player exits on some devices
   * where the React Native cleanup may not run before the activity is destroyed.
   */
  override fun onDestroy() {
    try {
      android.util.Log.d("VideoPlayerActivity", "onDestroy: Resetting hardware states")
      // Force Portrait snap before release to clear stuck sensors
      requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
      
      val params = window.attributes
      params.screenBrightness = android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
      window.attributes = params

      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
        requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      }, 100)
    } catch (e: Exception) {
      android.util.Log.w("VideoPlayerActivity", "Failed to reset state: ${e.message}")
    }
    super.onDestroy()
  }

  /**
   * Handle onNewIntent to support launching a new video while the activity is in PIP or background.
   * By calling recreate(), we ensure a fresh React bundle and intent props for the new video.
   */
  override fun onNewIntent(intent: Intent) {
      super.onNewIntent(intent)
      setIntent(intent)
      android.util.Log.d("VideoPlayerActivity", "onNewIntent: Recreating activity for new video")
      recreate()
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
      override fun getLaunchOptions(): Bundle? {
          val initialProps = Bundle()
          
          // Handle explicit extras from VideoPlayerModule
          intent?.extras?.let { extras ->
              initialProps.putAll(extras)
          }

          // Handle ACTION_VIEW (direct open) fallback
          intent?.data?.toString()?.let { uri ->
              if (!initialProps.containsKey("videoPath")) {
                  initialProps.putString("videoPath", uri)
              }
          }

          // Handle ACTION_SEND (share menu) fallback
          if (intent?.action == Intent.ACTION_SEND && intent?.type?.startsWith("video/") == true) {
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                  intent?.getParcelableExtra(Intent.EXTRA_STREAM, android.net.Uri::class.java)
              } else {
                  @Suppress("DEPRECATION")
                  intent?.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM)
              }?.let { uri ->
                  if (!initialProps.containsKey("videoPath")) {
                      initialProps.putString("videoPath", uri.toString())
                  }
              }
          }

          return initialProps
      }
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
      android.util.Log.w("VideoPlayerActivity", "Failed to notify PIP state change: ${e.message}")
    }
  }
}
