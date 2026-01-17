package com.glide.app;

import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.ContentObserver;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

/**
 * Unified Audio Control Module for Glide.
 * 
 * Handles:
 * - System volume control (0-100%)
 * - Audio route detection (speaker/bluetooth/wired/usb)
 * - Route-aware volume limits (speaker max 100%, external max 200%)
 * - Hardware button listening with app-change filtering
 * 
 * This module is designed to work smoothly with gesture-driven volume control
 * by avoiding feedback loops and providing atomic operations.
 */
public class AudioControlModule extends ReactContextBaseJavaModule implements LifecycleEventListener {

    private static final String TAG = "AudioControlModule";
    private static final String MODULE_NAME = "AudioControlModule";

    // Route type constants
    public static final String ROUTE_SPEAKER = "speaker";
    public static final String ROUTE_BLUETOOTH = "bluetooth";
    public static final String ROUTE_WIRED = "wired";
    public static final String ROUTE_USB = "usb";
    public static final String ROUTE_UNKNOWN = "unknown";

    // Event names
    private static final String EVENT_VOLUME_CHANGE = "onVolumeChange";
    private static final String EVENT_ROUTE_CHANGE = "onAudioRouteChange";

    private final ReactApplicationContext reactContext;
    private AudioManager audioManager;
    private Handler mainHandler;
    private ContentResolver contentResolver;

    // State
    private String currentRoute = ROUTE_SPEAKER;
    private int currentMaxVolume = 100; // 100 for speaker, 200 for external
    private boolean isListening = false;
    private boolean isAppChangingVolume = false; // Guard to filter out app-initiated changes
    private long lastAppVolumeChangeTime = 0;
    private static final long APP_CHANGE_DEBOUNCE_MS = 200;

    // Volume observer for hardware button detection
    private ContentObserver volumeObserver;

    // Audio device callback for route changes
    private AudioDeviceCallback audioDeviceCallback;

    // Broadcast receiver for audio becoming noisy
    private BroadcastReceiver noisyAudioReceiver;

    public AudioControlModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.mainHandler = new Handler(Looper.getMainLooper());

        reactContext.addLifecycleEventListener(this);

        if (reactContext != null) {
            audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
            contentResolver = reactContext.getContentResolver();
        }
    }

    @NonNull
    @Override
    public String getName() {
        return MODULE_NAME;
    }

    // =========================================================================
    // VOLUME CONTROL
    // =========================================================================

    /**
     * Set volume (0-200 range).
     * 0-100: System volume only
     * 101-200: System at max + VLC boost (handled by caller)
     * 
     * This method is designed to be called rapidly during gestures.
     * It marks the change as app-initiated to filter volume observer events.
     */
    @ReactMethod
    public void setVolume(int percentage, Promise promise) {
        try {
            if (audioManager == null) {
                promise.reject("ERROR", "AudioManager not available");
                return;
            }

            // Mark as app-initiated change
            isAppChangingVolume = true;
            lastAppVolumeChangeTime = System.currentTimeMillis();

            // Clamp based on current route
            int effectivePercentage = Math.max(0, Math.min(percentage, currentMaxVolume));

            // For speaker protection, hard cap at 100
            if (ROUTE_SPEAKER.equals(currentRoute) && effectivePercentage > 100) {
                effectivePercentage = 100;
            }

            // Calculate system volume (only 0-100% goes to system)
            int systemPercentage = Math.min(effectivePercentage, 100);

            int maxSystemVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int targetVolume = Math.round((systemPercentage / 100f) * maxSystemVolume);

            // Set system volume without showing UI
            audioManager.setStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    targetVolume,
                    0 // No flags - silent update
            );

            // Clear app-initiated flag after a short delay
            mainHandler.postDelayed(() -> {
                isAppChangingVolume = false;
            }, 50);

            WritableMap result = Arguments.createMap();
            result.putInt("volume", effectivePercentage);
            result.putInt("maxVolume", currentMaxVolume);
            result.putString("route", currentRoute);
            promise.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error setting volume: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Fast synchronous volume setter for gesture performance.
     * No promise resolution - fire and forget.
     */
    @ReactMethod
    public void setVolumeSync(int percentage) {
        if (audioManager == null) {
            return;
        }

        // Mark as app-initiated change
        isAppChangingVolume = true;
        lastAppVolumeChangeTime = System.currentTimeMillis();

        // Clamp based on current route
        int effectivePercentage = Math.max(0, Math.min(percentage, currentMaxVolume));

        // For speaker protection, hard cap at 100
        if (ROUTE_SPEAKER.equals(currentRoute) && effectivePercentage > 100) {
            effectivePercentage = 100;
        }

        // Calculate system volume (only 0-100% goes to system)
        int systemPercentage = Math.min(effectivePercentage, 100);

        int maxSystemVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int targetVolume = Math.round((systemPercentage / 100f) * maxSystemVolume);

        // Set system volume without showing UI
        audioManager.setStreamVolume(
                AudioManager.STREAM_MUSIC,
                targetVolume,
                0 // No flags - silent update
        );

        // Clear app-initiated flag after a short delay
        mainHandler.postDelayed(() -> {
            isAppChangingVolume = false;
        }, 50);
    }

    /**
     * Get current volume as percentage (0-100 for system).
     */
    @ReactMethod
    public void getVolume(Promise promise) {
        try {
            if (audioManager == null) {
                promise.reject("ERROR", "AudioManager not available");
                return;
            }

            int currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
            int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int percentage = Math.round((currentVolume / (float) maxVolume) * 100);

            WritableMap result = Arguments.createMap();
            result.putInt("volume", percentage);
            result.putInt("maxVolume", currentMaxVolume);
            result.putString("route", currentRoute);
            promise.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error getting volume: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    // =========================================================================
    // ROUTE DETECTION
    // =========================================================================

    /**
     * Get current audio route and its max volume limit.
     */
    @ReactMethod
    public void getCurrentRoute(Promise promise) {
        try {
            String route = detectCurrentRoute();
            int maxVol = getMaxVolumeForRoute(route);

            currentRoute = route;
            currentMaxVolume = maxVol;

            WritableMap result = Arguments.createMap();
            result.putString("route", route);
            result.putInt("maxVolume", maxVol);
            promise.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error getting route: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    private String detectCurrentRoute() {
        if (audioManager == null) {
            return ROUTE_SPEAKER;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            AudioDeviceInfo[] devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);

            String detectedRoute = ROUTE_SPEAKER;
            boolean foundExternal = false;

            for (AudioDeviceInfo device : devices) {
                String classified = classifyDevice(device);

                if (classified.equals(ROUTE_BLUETOOTH)) {
                    return ROUTE_BLUETOOTH; // Highest priority
                } else if (classified.equals(ROUTE_USB)) {
                    detectedRoute = ROUTE_USB;
                    foundExternal = true;
                } else if (classified.equals(ROUTE_WIRED)) {
                    if (!detectedRoute.equals(ROUTE_USB)) {
                        detectedRoute = ROUTE_WIRED;
                    }
                    foundExternal = true;
                } else if (classified.equals(ROUTE_UNKNOWN) && !device.isSource()) {
                    if (!foundExternal) {
                        detectedRoute = ROUTE_WIRED;
                        foundExternal = true;
                    }
                }
            }

            return detectedRoute;
        } else {
            // Fallback for older APIs
            if (audioManager.isBluetoothA2dpOn()) {
                return ROUTE_BLUETOOTH;
            } else if (audioManager.isWiredHeadsetOn()) {
                return ROUTE_WIRED;
            }
            return ROUTE_SPEAKER;
        }
    }

    private String classifyDevice(AudioDeviceInfo device) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return ROUTE_UNKNOWN;
        }

        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
            case AudioDeviceInfo.TYPE_TELEPHONY:
                return ROUTE_SPEAKER;

            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                return ROUTE_BLUETOOTH;

            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_LINE_ANALOG:
            case AudioDeviceInfo.TYPE_LINE_DIGITAL:
            case AudioDeviceInfo.TYPE_AUX_LINE:
            case AudioDeviceInfo.TYPE_HDMI:
                return ROUTE_WIRED;

            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
            case AudioDeviceInfo.TYPE_USB_DEVICE:
                return ROUTE_USB;

            case AudioDeviceInfo.TYPE_DOCK:
            case AudioDeviceInfo.TYPE_FM:
            case AudioDeviceInfo.TYPE_FM_TUNER:
            case AudioDeviceInfo.TYPE_TV_TUNER:
                return ROUTE_WIRED;

            default:
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    int type = device.getType();
                    if (type == 26 || type == 27) { // BLE devices
                        return ROUTE_BLUETOOTH;
                    }
                }
                return ROUTE_UNKNOWN;
        }
    }

    private int getMaxVolumeForRoute(String route) {
        if (ROUTE_SPEAKER.equals(route)) {
            return 100; // No boost for speaker
        }
        return 200; // Allow 200% boost for external devices
    }

    // =========================================================================
    // LISTENERS
    // =========================================================================

    @ReactMethod
    public void startListening() {
        if (isListening) {
            return;
        }

        Log.i(TAG, "Starting audio control listeners");
        isListening = true;

        // Set initial route
        currentRoute = detectCurrentRoute();
        currentMaxVolume = getMaxVolumeForRoute(currentRoute);

        // Register volume observer for hardware button detection
        registerVolumeObserver();

        // Register audio device callback for route changes
        registerAudioDeviceCallback();

        // Register noisy audio receiver
        registerNoisyAudioReceiver();
    }

    @ReactMethod
    public void stopListening() {
        if (!isListening) {
            return;
        }

        Log.i(TAG, "Stopping audio control listeners");
        isListening = false;

        unregisterVolumeObserver();
        unregisterAudioDeviceCallback();
        unregisterNoisyAudioReceiver();
    }

    private void registerVolumeObserver() {
        if (volumeObserver != null || contentResolver == null) {
            return;
        }

        volumeObserver = new ContentObserver(mainHandler) {
            @Override
            public void onChange(boolean selfChange) {
                // Filter out app-initiated changes
                long now = System.currentTimeMillis();
                if (isAppChangingVolume || (now - lastAppVolumeChangeTime < APP_CHANGE_DEBOUNCE_MS)) {
                    return;
                }

                // This is a hardware button press
                handleHardwareVolumeChange();
            }
        };

        contentResolver.registerContentObserver(
                Settings.System.CONTENT_URI,
                true,
                volumeObserver);
    }

    private void unregisterVolumeObserver() {
        if (volumeObserver != null && contentResolver != null) {
            contentResolver.unregisterContentObserver(volumeObserver);
            volumeObserver = null;
        }
    }

    private void handleHardwareVolumeChange() {
        if (audioManager == null) {
            return;
        }

        int currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int percentage = Math.round((currentVolume / (float) maxVolume) * 100);

        Log.d(TAG, "Hardware volume change detected: " + percentage + "%");

        WritableMap params = Arguments.createMap();
        params.putInt("volume", percentage);
        params.putInt("maxVolume", currentMaxVolume);
        params.putString("route", currentRoute);
        params.putBoolean("fromHardware", true);

        sendEvent(EVENT_VOLUME_CHANGE, params);
    }

    private void registerAudioDeviceCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audioManager != null) {
            audioDeviceCallback = new AudioDeviceCallback() {
                @Override
                public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices) {
                    handleRouteChange();
                }

                @Override
                public void onAudioDevicesRemoved(AudioDeviceInfo[] removedDevices) {
                    handleRouteChange();
                }
            };

            audioManager.registerAudioDeviceCallback(audioDeviceCallback, mainHandler);
        }
    }

    private void unregisterAudioDeviceCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audioManager != null && audioDeviceCallback != null) {
            audioManager.unregisterAudioDeviceCallback(audioDeviceCallback);
            audioDeviceCallback = null;
        }
    }

    private void handleRouteChange() {
        mainHandler.postDelayed(() -> {
            String previousRoute = currentRoute;
            String newRoute = detectCurrentRoute();
            int newMaxVolume = getMaxVolumeForRoute(newRoute);

            if (!newRoute.equals(previousRoute)) {
                currentRoute = newRoute;
                currentMaxVolume = newMaxVolume;

                Log.i(TAG, "Route changed: " + previousRoute + " -> " + newRoute);

                WritableMap params = Arguments.createMap();
                params.putString("route", newRoute);
                params.putString("previousRoute", previousRoute);
                params.putInt("maxVolume", newMaxVolume);

                sendEvent(EVENT_ROUTE_CHANGE, params);
            }
        }, 100);
    }

    private void registerNoisyAudioReceiver() {
        if (noisyAudioReceiver != null) {
            return;
        }

        noisyAudioReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                    String previousRoute = currentRoute;
                    currentRoute = ROUTE_SPEAKER;
                    currentMaxVolume = 100;

                    if (!currentRoute.equals(previousRoute)) {
                        WritableMap params = Arguments.createMap();
                        params.putString("route", currentRoute);
                        params.putString("previousRoute", previousRoute);
                        params.putInt("maxVolume", currentMaxVolume);

                        sendEvent(EVENT_ROUTE_CHANGE, params);
                    }
                }
            }
        };

        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        reactContext.registerReceiver(noisyAudioReceiver, filter);
    }

    private void unregisterNoisyAudioReceiver() {
        if (noisyAudioReceiver != null) {
            try {
                reactContext.unregisterReceiver(noisyAudioReceiver);
            } catch (Exception e) {
                Log.w(TAG, "Error unregistering receiver: " + e.getMessage());
            }
            noisyAudioReceiver = null;
        }
    }

    // =========================================================================
    // EVENT EMISSION
    // =========================================================================

    private void sendEvent(String eventName, @Nullable WritableMap params) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(eventName, params);
        }
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    @Override
    public void onHostResume() {
        // Resume listening if it was active
    }

    @Override
    public void onHostPause() {
        // Keep listening in background
    }

    @Override
    public void onHostDestroy() {
        stopListening();
    }

    // =========================================================================
    // BRIGHTNESS CONTROL
    // =========================================================================

    /**
     * Set app brightness (0.0 to 1.0).
     * This only affects the current activity's window, not system brightness.
     */
    @ReactMethod
    public void setBrightness(float brightness, Promise promise) {
        try {
            android.app.Activity activity = getCurrentActivity();
            if (activity == null) {
                promise.reject("ERROR", "No activity available");
                return;
            }

            final float finalBrightness = Math.max(0f, Math.min(1f, brightness));

            activity.runOnUiThread(() -> {
                try {
                    android.view.WindowManager.LayoutParams params = activity.getWindow().getAttributes();
                    params.screenBrightness = finalBrightness;
                    activity.getWindow().setAttributes(params);
                    promise.resolve(finalBrightness);
                } catch (Exception e) {
                    promise.reject("ERROR", e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error setting brightness: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Fast synchronous brightness setter for gesture performance.
     * No promise - fire and forget.
     */
    @ReactMethod
    public void setBrightnessSync(float brightness) {
        try {
            android.app.Activity activity = getCurrentActivity();
            if (activity == null) {
                return;
            }

            final float finalBrightness = Math.max(0f, Math.min(1f, brightness));

            activity.runOnUiThread(() -> {
                try {
                    android.view.WindowManager.LayoutParams params = activity.getWindow().getAttributes();
                    params.screenBrightness = finalBrightness;
                    activity.getWindow().setAttributes(params);
                } catch (Exception e) {
                    Log.e(TAG, "Error setting brightness sync: " + e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error setting brightness: " + e.getMessage());
        }
    }

    /**
     * Get current window brightness.
     * Returns -1 if using system default.
     */
    @ReactMethod
    public void getBrightness(Promise promise) {
        try {
            android.app.Activity activity = getCurrentActivity();
            if (activity == null) {
                promise.reject("ERROR", "No activity available");
                return;
            }

            activity.runOnUiThread(() -> {
                try {
                    android.view.WindowManager.LayoutParams params = activity.getWindow().getAttributes();
                    float brightness = params.screenBrightness;

                    // If brightness is -1 (system default), get actual system brightness
                    if (brightness < 0) {
                        try {
                            int systemBrightness = Settings.System.getInt(
                                    contentResolver,
                                    Settings.System.SCREEN_BRIGHTNESS);
                            brightness = systemBrightness / 255f;
                        } catch (Settings.SettingNotFoundException e) {
                            brightness = 0.5f; // Default fallback
                        }
                    }

                    promise.resolve(brightness);
                } catch (Exception e) {
                    promise.reject("ERROR", e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error getting brightness: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Reset brightness to system default.
     */
    @ReactMethod
    public void resetBrightness(Promise promise) {
        try {
            android.app.Activity activity = getCurrentActivity();
            if (activity == null) {
                promise.reject("ERROR", "No activity available");
                return;
            }

            activity.runOnUiThread(() -> {
                try {
                    android.view.WindowManager.LayoutParams params = activity.getWindow().getAttributes();
                    params.screenBrightness = -1f; // -1 means use system default
                    activity.getWindow().setAttributes(params);
                    promise.resolve(true);
                } catch (Exception e) {
                    promise.reject("ERROR", e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error resetting brightness: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }
}
