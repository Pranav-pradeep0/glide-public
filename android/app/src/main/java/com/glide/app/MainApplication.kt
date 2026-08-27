package com.glide.app

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.glide.app.haptic.HapticPackage
import com.glide.app.pip.PipPackage
import com.reactnativesimplethumbnail.SimpleThumbnailPackage

class MainApplication : Application(), ReactApplication {

  // ReactNativeHost throws under the New Architecture in 0.87; ReactHost replaces it.
  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
        context = applicationContext,
        packageList =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here.
              add(HapticPackage())
              add(com.glide.app.orientation.VideoOrientationPackage())
              add(PipPackage())
              add(SimpleThumbnailPackage())
              add(AudioControlPackage())
              add(SplashPackage())
              add(ApkInstallerPackage())
            },
        // Stallion hands back the downloaded OTA bundle, or null to fall through to the
        // bundle packaged in the APK. This replaces the old getJSBundleFile() override.
        jsBundleFilePath = com.stallion.Stallion.getJSBundleFile(applicationContext),
        useDevSupport = BuildConfig.DEBUG,
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Replaces SoLoader.init plus the New Architecture entry point load().
    loadReactNative(this)
  }
}
