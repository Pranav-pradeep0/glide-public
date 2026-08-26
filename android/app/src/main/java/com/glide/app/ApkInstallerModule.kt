package com.glide.app

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Session-based APK install. ACTION_VIEW with a FileProvider URI is fire-and-forget: it
 * reports success as soon as the installer Activity starts, so a rejected APK looks
 * identical to an installed one. PackageInstaller reports a real terminal status, which
 * is the only way the app can tell the user why an update did not apply.
 */
class ApkInstallerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var pendingPromise: Promise? = null
    private var statusReceiver: BroadcastReceiver? = null

    override fun getName(): String = "ApkInstallerModule"

    // React Native exposes no ABI constant, so the update asset picker reads it from here.
    override fun getConstants(): Map<String, Any> = mapOf(
        "SUPPORTED_ABIS" to Build.SUPPORTED_ABIS.toList()
    )

    @ReactMethod
    fun canInstallPackages(promise: Promise) {
        // minSdk is 26, so this is always available.
        promise.resolve(reactApplicationContext.packageManager.canRequestPackageInstalls())
    }

    @ReactMethod
    fun openUnknownSourcesSettings(promise: Promise) {
        try {
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + reactApplicationContext.packageName)
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SETTINGS_UNAVAILABLE", e.message, e)
        }
    }

    @ReactMethod
    fun install(filePath: String, promise: Promise) {
        val context = reactApplicationContext

        val file = try {
            File(filePath).canonicalFile
        } catch (e: Exception) {
            promise.reject("INVALID_FILE", "Cannot resolve the APK path", e)
            return
        }

        // Only ever install an APK this app downloaded into its own cache.
        val cacheRoot = context.cacheDir.canonicalFile
        if (!file.path.startsWith(cacheRoot.path + File.separator)) {
            promise.reject("INVALID_FILE", "APK is outside the app cache directory")
            return
        }
        if (!file.isFile || !file.name.endsWith(".apk", ignoreCase = true) || file.length() <= 0L) {
            promise.reject("INVALID_FILE", "Not a readable APK file")
            return
        }
        if (!context.packageManager.canRequestPackageInstalls()) {
            promise.reject("UNKNOWN_SOURCES_DENIED", "Install from unknown sources is not permitted")
            return
        }
        if (pendingPromise != null) {
            promise.reject("INSTALL_BUSY", "An install is already in progress")
            return
        }

        pendingPromise = promise
        registerStatusReceiver()

        var sessionId = -1
        val installer = context.packageManager.packageInstaller
        try {
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(context.packageName)
            params.setInstallReason(PackageManager.INSTALL_REASON_USER)
            if (Build.VERSION.SDK_INT >= 34) {
                // Keep Glide the update owner so no other installer can replace it silently.
                params.setRequestUpdateOwnership(true)
            }
            sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                session.openWrite("glide-update", 0, file.length()).use { out ->
                    file.inputStream().use { input -> input.copyTo(out) }
                    session.fsync(out)
                }
                session.commit(buildStatusSender(sessionId))
            }
        } catch (e: Exception) {
            if (sessionId != -1) {
                runCatching { installer.abandonSession(sessionId) }
            }
            settleReject("INSTALL_FAILED", e.message ?: "Could not start the install session")
        }
    }

    private fun statusAction(): String =
        reactApplicationContext.packageName + ".APK_INSTALL_STATUS"

    private fun buildStatusSender(sessionId: Int) = PendingIntent.getBroadcast(
        reactApplicationContext,
        sessionId,
        Intent(statusAction()).setPackage(reactApplicationContext.packageName),
        // MUTABLE so the system can attach the status extras.
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
    ).intentSender

    private fun registerStatusReceiver() {
        if (statusReceiver != null) {
            return
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) = onInstallStatus(intent)
        }
        statusReceiver = receiver
        ContextCompat.registerReceiver(
            reactApplicationContext,
            receiver,
            IntentFilter(statusAction()),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    private fun onInstallStatus(intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Not terminal: show the system confirmation and keep waiting for the result.
            val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
            if (confirm == null) {
                settleReject("INSTALL_FAILED", "System did not supply a confirmation prompt")
                return
            }
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { reactApplicationContext.startActivity(confirm) }
                .onFailure { settleReject("INSTALL_FAILED", it.message ?: "Cannot show the install prompt") }
            return
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            // Usually unreachable: applying the update kills this process.
            settleResolve()
            return
        }

        settleReject(errorCodeFor(status), message ?: "Install failed with status $status")
    }

    private fun errorCodeFor(status: Int): String = when (status) {
        PackageInstaller.STATUS_FAILURE_ABORTED -> "INSTALL_CANCELLED"
        PackageInstaller.STATUS_FAILURE_BLOCKED -> "INSTALL_BLOCKED"
        PackageInstaller.STATUS_FAILURE_CONFLICT -> "INSTALL_CONFLICT"
        PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "INSTALL_INCOMPATIBLE"
        PackageInstaller.STATUS_FAILURE_INVALID -> "INSTALL_INVALID"
        PackageInstaller.STATUS_FAILURE_STORAGE -> "INSTALL_STORAGE"
        else -> "INSTALL_FAILED"
    }

    private fun settleResolve() {
        val promise = pendingPromise
        cleanUp()
        promise?.resolve(true)
    }

    private fun settleReject(code: String, message: String) {
        val promise = pendingPromise
        cleanUp()
        promise?.reject(code, message)
    }

    private fun cleanUp() {
        pendingPromise = null
        statusReceiver?.let { receiver ->
            runCatching { reactApplicationContext.unregisterReceiver(receiver) }
        }
        statusReceiver = null
    }

    override fun invalidate() {
        cleanUp()
        super.invalidate()
    }
}
