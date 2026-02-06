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
import androidx.annotation.RequiresApi;

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
 * <p>
 * This module provides comprehensive audio and brightness management for the
 * video player,
 * with special handling for custom Android ROMs (e.g., iQOO, MIUI, ColorOS).
 * </p>
 * 
 * <h2>Core Functionality:</h2>
 * <ul>
 * <li><b>Volume Control:</b> System volume (0-100%) with VLC boost support
 * (101-200%)</li>
 * <li><b>Audio Routing:</b> Automatic detection of speaker/bluetooth/wired/USB
 * devices</li>
 * <li><b>Route-Aware Limits:</b> Speaker max 100%, external devices max
 * 200%</li>
 * <li><b>Hardware Button Detection:</b> Filters app-initiated changes to avoid
 * feedback loops</li>
 * <li><b>Brightness Control:</b> Automatic caching and restoration with custom
 * ROM compatibility</li>
 * </ul>
 * 
 * <h2>Lifecycle Management:</h2>
 * <ul>
 * <li>{@link #startListening()} - Called when video player opens (auto-caches
 * brightness)</li>
 * <li>{@link #stopListening()} - Called when video player closes (auto-resets
 * brightness)</li>
 * <li>{@link #onHostDestroy()} - Safety net for unexpected termination</li>
 * </ul>
 * 
 * <h2>Thread Safety:</h2>
 * <p>
 * All UI operations run on the main thread. Audio operations are synchronized
 * to prevent
 * race conditions during rapid gesture input.
 * </p>
 * 
 * @version 2.0.0
 * @since 2024-12-01
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

    // Timing constants
    private static final long APP_CHANGE_DEBOUNCE_MS = 200;
    private static final long BRIGHTNESS_RESET_DELAY_MS = 100;
    private static final long VOLUME_FLAG_CLEAR_DELAY_MS = 50;

    // Brightness constants
    private static final int DEFAULT_BRIGHTNESS_VALUE = 128; // 50% of 255
    private static final float DEFAULT_BRIGHTNESS_NORMALIZED = 0.5f;
    private static final float BRIGHTNESS_CHANGE_THRESHOLD = 0.01f; // 1% tolerance

    // React Native context and system services
    private final ReactApplicationContext reactContext;
    private final Handler mainHandler;
    private AudioManager audioManager;
    private ContentResolver contentResolver;

    // Audio routing state
    private volatile String currentRoute = ROUTE_SPEAKER;
    private volatile int currentMaxVolume = 100; // 100 for speaker, 200 for external

    // Lifecycle state
    private volatile boolean isListening = false;

    // Volume change detection (prevents feedback loops)
    private volatile boolean isAppChangingVolume = false;
    private volatile long lastAppVolumeChangeTime = 0;

    // Brightness state (thread-safe with volatile)
    private volatile float initialSystemBrightness = -1f;
    private volatile boolean brightnessInitialized = false;

    // Observers and callbacks
    private ContentObserver volumeObserver;
    private AudioDeviceCallback audioDeviceCallback;
    private BroadcastReceiver noisyAudioReceiver;

    // Static instance for MainActivity access
    private static volatile AudioControlModule sInstance;

    // =========================================================================
    // CONSTRUCTOR & INITIALIZATION
    // =========================================================================

    /**
     * Constructs the AudioControlModule.
     * 
     * <p>
     * Initializes system services and sets up lifecycle listeners.
     * This constructor is called by React Native's module initialization.
     * </p>
     * 
     * @param reactContext The React Native application context
     */
    public AudioControlModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.mainHandler = new Handler(Looper.getMainLooper());

        // Set static instance for MainActivity access
        sInstance = this;

        // Register lifecycle listener
        reactContext.addLifecycleEventListener(this);

        // Initialize system services
        initializeSystemServices();

        Log.d(TAG, "AudioControlModule initialized (API " + Build.VERSION.SDK_INT + ")");
    }

    /**
     * Initializes Android system services with null safety.
     */
    private void initializeSystemServices() {
        if (reactContext != null) {
            try {
                audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
                contentResolver = reactContext.getContentResolver();

                if (audioManager == null) {
                    Log.e(TAG, "AudioManager is null - audio features will be disabled");
                }
                if (contentResolver == null) {
                    Log.e(TAG, "ContentResolver is null - brightness features may be limited");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error initializing system services", e);
            }
        }
    }

    /**
     * Returns the singleton instance for MainActivity access.
     * 
     * @return The module instance, or null if not yet initialized
     */
    public static AudioControlModule getInstance() {
        return sInstance;
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
     * Sets system volume with route-aware limits.
     * 
     * <p>
     * <b>Volume Range:</b>
     * </p>
     * <ul>
     * <li>0-100: System volume only</li>
     * <li>101-200: System at max + VLC boost (handled by caller)</li>
     * </ul>
     * 
     * <p>
     * <b>Route Protection:</b>
     * </p>
     * <ul>
     * <li>Speaker: Hard capped at 100% (speaker protection)</li>
     * <li>External devices: Allows up to 200% (headphones/bluetooth safe)</li>
     * </ul>
     * 
     * <p>
     * This method marks the change as app-initiated to filter out hardware
     * button events and prevent feedback loops.
     * </p>
     * 
     * @param percentage Volume level (0-200)
     * @param promise    React Native promise for result callback
     */
    @ReactMethod
    public void setVolume(int percentage, Promise promise) {
        try {
            if (audioManager == null) {
                promise.reject("ERROR", "AudioManager not available");
                return;
            }

            // Mark as app-initiated change
            synchronized (this) {
                isAppChangingVolume = true;
                lastAppVolumeChangeTime = System.currentTimeMillis();
            }

            // Clamp based on current route
            int effectivePercentage = Math.max(0, Math.min(percentage, currentMaxVolume));

            // Speaker protection: hard cap at 100
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

            // Clear app-initiated flag after short delay
            mainHandler.postDelayed(() -> {
                synchronized (AudioControlModule.this) {
                    isAppChangingVolume = false;
                }
            }, VOLUME_FLAG_CLEAR_DELAY_MS);

            // Return result
            WritableMap result = Arguments.createMap();
            result.putInt("volume", effectivePercentage);
            result.putInt("maxVolume", currentMaxVolume);
            result.putString("route", currentRoute);
            promise.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error setting volume", e);
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Fast synchronous volume setter for gesture performance.
     * 
     * <p>
     * This is a fire-and-forget version of {@link #setVolume(int, Promise)}
     * optimized for rapid gesture updates. No promise resolution overhead.
     * </p>
     * 
     * @param percentage Volume level (0-200)
     */
    @ReactMethod
    public void setVolumeSync(int percentage) {
        if (audioManager == null) {
            return;
        }

        try {
            // Mark as app-initiated change
            synchronized (this) {
                isAppChangingVolume = true;
                lastAppVolumeChangeTime = System.currentTimeMillis();
            }

            // Clamp based on current route
            int effectivePercentage = Math.max(0, Math.min(percentage, currentMaxVolume));

            // Speaker protection
            if (ROUTE_SPEAKER.equals(currentRoute) && effectivePercentage > 100) {
                effectivePercentage = 100;
            }

            // Calculate system volume
            int systemPercentage = Math.min(effectivePercentage, 100);
            int maxSystemVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int targetVolume = Math.round((systemPercentage / 100f) * maxSystemVolume);

            // Set volume
            audioManager.setStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    targetVolume,
                    0);

            // Clear flag
            mainHandler.postDelayed(() -> {
                synchronized (AudioControlModule.this) {
                    isAppChangingVolume = false;
                }
            }, VOLUME_FLAG_CLEAR_DELAY_MS);

        } catch (Exception e) {
            Log.e(TAG, "Error in setVolumeSync", e);
        }
    }

    /**
     * Gets current system volume as percentage.
     * 
     * @param promise Promise resolving to volume data
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
            int percentage = maxVolume > 0 ? Math.round((currentVolume / (float) maxVolume) * 100) : 0;

            WritableMap result = Arguments.createMap();
            result.putInt("volume", percentage);
            result.putInt("maxVolume", currentMaxVolume);
            result.putString("route", currentRoute);
            promise.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error getting volume", e);
            promise.reject("ERROR", e.getMessage());
        }
    }

    // =========================================================================
    // AUDIO ROUTE DETECTION
    // =========================================================================

    /**
     * Gets current audio route and its volume limit.
     * 
     * @param promise Promise resolving to route data
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
            Log.e(TAG, "Error getting route", e);
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Detects the current audio output route.
     * 
     * <p>
     * <b>Priority Order:</b>
     * </p>
     * <ol>
     * <li>Bluetooth (highest priority)</li>
     * <li>USB</li>
     * <li>Wired (3.5mm, HDMI, etc.)</li>
     * <li>Speaker (fallback)</li>
     * </ol>
     * 
     * @return Route type constant
     */
    private String detectCurrentRoute() {
        if (audioManager == null) {
            return ROUTE_SPEAKER;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return detectCurrentRouteModern();
        } else {
            return detectCurrentRouteLegacy();
        }
    }

    /**
     * Modern route detection using AudioDeviceInfo API (Android M+).
     */
    @RequiresApi(api = Build.VERSION_CODES.M)
    private String detectCurrentRouteModern() {
        AudioDeviceInfo[] devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);

        String detectedRoute = ROUTE_SPEAKER;
        boolean foundExternal = false;

        for (AudioDeviceInfo device : devices) {
            String classified = classifyDevice(device);

            // Bluetooth has highest priority
            if (classified.equals(ROUTE_BLUETOOTH)) {
                return ROUTE_BLUETOOTH;
            } else if (classified.equals(ROUTE_USB)) {
                detectedRoute = ROUTE_USB;
                foundExternal = true;
            } else if (classified.equals(ROUTE_WIRED)) {
                if (!detectedRoute.equals(ROUTE_USB)) {
                    detectedRoute = ROUTE_WIRED;
                }
                foundExternal = true;
            } else if (classified.equals(ROUTE_UNKNOWN) && !device.isSource()) {
                // Unknown output device - treat as wired if no better match
                if (!foundExternal) {
                    detectedRoute = ROUTE_WIRED;
                    foundExternal = true;
                }
            }
        }

        return detectedRoute;
    }

    /**
     * Legacy route detection for Android < M.
     */
    @SuppressWarnings("deprecation")
    private String detectCurrentRouteLegacy() {
        if (audioManager.isBluetoothA2dpOn()) {
            return ROUTE_BLUETOOTH;
        } else if (audioManager.isWiredHeadsetOn()) {
            return ROUTE_WIRED;
        }
        return ROUTE_SPEAKER;
    }

    /**
     * Classifies an audio device into a route type.
     * 
     * @param device The audio device to classify
     * @return Route type constant
     */
    @RequiresApi(api = Build.VERSION_CODES.M)
    private String classifyDevice(AudioDeviceInfo device) {
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
            case AudioDeviceInfo.TYPE_DOCK:
            case AudioDeviceInfo.TYPE_FM:
            case AudioDeviceInfo.TYPE_FM_TUNER:
            case AudioDeviceInfo.TYPE_TV_TUNER:
                return ROUTE_WIRED;

            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
            case AudioDeviceInfo.TYPE_USB_DEVICE:
                return ROUTE_USB;

            default:
                // Handle BLE devices on Android S+
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    int type = device.getType();
                    if (type == 26 || type == 27) { // BLE_HEADSET, BLE_SPEAKER
                        return ROUTE_BLUETOOTH;
                    }
                }
                return ROUTE_UNKNOWN;
        }
    }

    /**
     * Gets the maximum allowed volume for a given route.
     * 
     * @param route Route type constant
     * @return Max volume (100 for speaker, 200 for external)
     */
    private int getMaxVolumeForRoute(String route) {
        if (ROUTE_SPEAKER.equals(route)) {
            return 100; // No boost for speaker (hearing protection)
        }
        return 200; // Allow 200% boost for external devices
    }

    // =========================================================================
    // LISTENERS & EVENT HANDLING
    // =========================================================================

    /**
     * Starts listening for volume and route changes.
     * 
     * <p>
     * <b>Called when video player opens.</b>
     * </p>
     * 
     * <p>
     * This method:
     * </p>
     * <ul>
     * <li>Detects current audio route</li>
     * <li>Caches system brightness (automatic)</li>
     * <li>Registers volume observer for hardware button detection</li>
     * <li>Registers audio device callback for route change detection</li>
     * <li>Registers noisy audio receiver for headphone disconnect</li>
     * </ul>
     */
    @ReactMethod
    public void startListening() {
        if (isListening) {
            Log.d(TAG, "Already listening, ignoring startListening call");
            return;
        }

        Log.i(TAG, "Starting audio control listeners");
        isListening = true;

        // Detect initial audio route
        currentRoute = detectCurrentRoute();
        currentMaxVolume = getMaxVolumeForRoute(currentRoute);
        Log.d(TAG, "Initial route: " + currentRoute + ", maxVolume: " + currentMaxVolume);

        // AUTOMATIC BRIGHTNESS CACHING
        // This ensures we capture the system brightness before any video player
        // adjustments
        cacheSystemBrightness();

        // Register observers
        registerVolumeObserver();
        registerAudioDeviceCallback();
        registerNoisyAudioReceiver();
    }

    /**
     * Stops listening for volume and route changes.
     * 
     * <p>
     * <b>Called when video player closes.</b>
     * </p>
     * 
     * <p>
     * This method:
     * </p>
     * <ul>
     * <li>Unregisters all observers and callbacks</li>
     * <li>Resets brightness to cached system value (automatic)</li>
     * </ul>
     */
    @ReactMethod
    public void stopListening() {
        if (!isListening) {
            Log.d(TAG, "Not listening, ignoring stopListening call");
            return;
        }

        Log.i(TAG, "Stopping audio control listeners");
        isListening = false;

        // Unregister observers
        unregisterVolumeObserver();
        unregisterAudioDeviceCallback();
        unregisterNoisyAudioReceiver();

        // AUTOMATIC BRIGHTNESS RESET
        // Reset brightness to cached system value when video player closes
        if (brightnessInitialized && initialSystemBrightness >= 0) {
            Log.i(TAG, "Auto-resetting brightness on stopListening");
            resetBrightnessSync();
        } else {
            Log.w(TAG, "Skipping brightness reset: not initialized or invalid cached value");
        }
    }

    /**
     * Registers volume observer for hardware button detection.
     */
    private void registerVolumeObserver() {
        if (volumeObserver != null || contentResolver == null) {
            return;
        }

        try {
            volumeObserver = new ContentObserver(mainHandler) {
                @Override
                public void onChange(boolean selfChange) {
                    handleVolumeObserverChange();
                }
            };

            contentResolver.registerContentObserver(
                    Settings.System.CONTENT_URI,
                    true,
                    volumeObserver);

            Log.d(TAG, "Volume observer registered");
        } catch (Exception e) {
            Log.e(TAG, "Error registering volume observer", e);
        }
    }

    /**
     * Handles volume observer changes (filters out app-initiated changes).
     */
    private void handleVolumeObserverChange() {
        // Filter out app-initiated changes
        synchronized (this) {
            long now = System.currentTimeMillis();
            if (isAppChangingVolume || (now - lastAppVolumeChangeTime < APP_CHANGE_DEBOUNCE_MS)) {
                return;
            }
        }

        // This is a hardware button press
        handleHardwareVolumeChange();
    }

    /**
     * Unregisters volume observer.
     */
    private void unregisterVolumeObserver() {
        if (volumeObserver != null && contentResolver != null) {
            try {
                contentResolver.unregisterContentObserver(volumeObserver);
                volumeObserver = null;
                Log.d(TAG, "Volume observer unregistered");
            } catch (Exception e) {
                Log.e(TAG, "Error unregistering volume observer", e);
            }
        }
    }

    /**
     * Handles hardware volume button changes.
     */
    private void handleHardwareVolumeChange() {
        if (audioManager == null) {
            return;
        }

        try {
            int currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
            int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int percentage = maxVolume > 0 ? Math.round((currentVolume / (float) maxVolume) * 100) : 0;

            Log.d(TAG, "Hardware volume change detected: " + percentage + "%");

            WritableMap params = Arguments.createMap();
            params.putInt("volume", percentage);
            params.putInt("maxVolume", currentMaxVolume);
            params.putString("route", currentRoute);
            params.putBoolean("fromHardware", true);

            sendEvent(EVENT_VOLUME_CHANGE, params);
        } catch (Exception e) {
            Log.e(TAG, "Error handling hardware volume change", e);
        }
    }

    /**
     * Registers audio device callback for route change detection (Android M+).
     */
    private void registerAudioDeviceCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || audioManager == null) {
            return;
        }

        try {
            audioDeviceCallback = new AudioDeviceCallback() {
                @Override
                public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices) {
                    Log.d(TAG, "Audio devices added: " + addedDevices.length);
                    handleRouteChange();
                }

                @Override
                public void onAudioDevicesRemoved(AudioDeviceInfo[] removedDevices) {
                    Log.d(TAG, "Audio devices removed: " + removedDevices.length);
                    handleRouteChange();
                }
            };

            audioManager.registerAudioDeviceCallback(audioDeviceCallback, mainHandler);
            Log.d(TAG, "Audio device callback registered");
        } catch (Exception e) {
            Log.e(TAG, "Error registering audio device callback", e);
        }
    }

    /**
     * Unregisters audio device callback.
     */
    private void unregisterAudioDeviceCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || audioManager == null || audioDeviceCallback == null) {
            return;
        }

        try {
            audioManager.unregisterAudioDeviceCallback(audioDeviceCallback);
            audioDeviceCallback = null;
            Log.d(TAG, "Audio device callback unregistered");
        } catch (Exception e) {
            Log.e(TAG, "Error unregistering audio device callback", e);
        }
    }

    /**
     * Handles audio route changes.
     * 
     * <p>
     * Debounced to prevent multiple events from rapid route switches.
     * </p>
     */
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
        }, 100); // Debounce delay
    }

    /**
     * Registers broadcast receiver for headphone disconnect detection.
     */
    private void registerNoisyAudioReceiver() {
        if (noisyAudioReceiver != null) {
            return;
        }

        try {
            noisyAudioReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                        handleAudioBecomingNoisy();
                    }
                }
            };

            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            reactContext.registerReceiver(noisyAudioReceiver, filter);
            Log.d(TAG, "Noisy audio receiver registered");
        } catch (Exception e) {
            Log.e(TAG, "Error registering noisy audio receiver", e);
        }
    }

    /**
     * Handles audio becoming noisy (headphones disconnected).
     */
    private void handleAudioBecomingNoisy() {
        String previousRoute = currentRoute;
        currentRoute = ROUTE_SPEAKER;
        currentMaxVolume = 100;

        Log.i(TAG, "Audio becoming noisy: " + previousRoute + " -> " + ROUTE_SPEAKER);

        if (!currentRoute.equals(previousRoute)) {
            WritableMap params = Arguments.createMap();
            params.putString("route", currentRoute);
            params.putString("previousRoute", previousRoute);
            params.putInt("maxVolume", currentMaxVolume);

            sendEvent(EVENT_ROUTE_CHANGE, params);
        }
    }

    /**
     * Unregisters noisy audio receiver.
     */
    private void unregisterNoisyAudioReceiver() {
        if (noisyAudioReceiver != null) {
            try {
                reactContext.unregisterReceiver(noisyAudioReceiver);
                noisyAudioReceiver = null;
                Log.d(TAG, "Noisy audio receiver unregistered");
            } catch (Exception e) {
                Log.e(TAG, "Error unregistering noisy audio receiver", e);
            }
        }
    }

    /**
     * Sends an event to React Native.
     * 
     * @param eventName Event name
     * @param params    Event parameters (nullable)
     */
    private void sendEvent(String eventName, @Nullable WritableMap params) {
        if (reactContext.hasActiveReactInstance()) {
            try {
                reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                        .emit(eventName, params);
            } catch (Exception e) {
                Log.e(TAG, "Error sending event: " + eventName, e);
            }
        }
    }

    // =========================================================================
    // MAINACTIVITY INTEGRATION
    // =========================================================================

    /**
     * Checks if module is actively listening (video player is open).
     * 
     * <p>
     * Called by MainActivity to determine whether to intercept volume keys.
     * </p>
     * 
     * @return true if listening, false otherwise
     */
    public boolean isListeningForVolumeChanges() {
        return isListening;
    }

    /**
     * Emits a hardware volume change event to React Native.
     * 
     * <p>
     * Called by MainActivity after intercepting and handling a volume key press.
     * </p>
     */
    public void emitHardwareVolumeChange() {
        handleHardwareVolumeChange();
    }

    // =========================================================================
    // LIFECYCLE CALLBACKS
    // =========================================================================

    @Override
    public void onHostResume() {
        // No action needed - listening state is managed by startListening/stopListening
        Log.d(TAG, "onHostResume");
    }

    @Override
    public void onHostPause() {
        // Keep listening in background (video can play in background)
        Log.d(TAG, "onHostPause");
    }

    @Override
    public void onHostDestroy() {
        Log.i(TAG, "onHostDestroy - cleaning up");

        // SAFETY NET: Reset brightness before cleanup
        // This handles cases where stopListening() wasn't called (e.g., app crash/kill)
        if (brightnessInitialized && initialSystemBrightness >= 0) {
            Log.i(TAG, "Auto-resetting brightness on destroy (safety net)");
            resetBrightnessSync();
        }

        // Stop listening (will unregister all observers)
        stopListening();
    }

    // =========================================================================
    // BRIGHTNESS CONTROL
    // =========================================================================

    /**
     * Caches the current system brightness value.
     * 
     * <p>
     * <b>Called automatically by {@link #startListening()}.</b>
     * </p>
     * 
     * <p>
     * This captures the system brightness before any video player adjustments,
     * ensuring we can restore it accurately when the player closes.
     * </p>
     * 
     * <p>
     * <b>Custom ROM Compatibility:</b>
     * </p>
     * <ul>
     * <li>Works on MIUI, ColorOS, FunTouch OS (iQOO), OneUI, etc.</li>
     * <li>Uses standard Android Settings API (universally supported)</li>
     * <li>Fallback to 50% if settings unavailable</li>
     * </ul>
     */
    private void cacheSystemBrightness() {
        if (contentResolver == null) {
            Log.w(TAG, "ContentResolver not available, using default brightness");
            initialSystemBrightness = DEFAULT_BRIGHTNESS_NORMALIZED;
            brightnessInitialized = true;
            return;
        }

        try {
            int systemBrightness = Settings.System.getInt(
                    contentResolver,
                    Settings.System.SCREEN_BRIGHTNESS,
                    DEFAULT_BRIGHTNESS_VALUE);

            // Normalize to 0.0-1.0 range
            initialSystemBrightness = systemBrightness / 255f;
            brightnessInitialized = true;

            Log.i(TAG, "Cached system brightness: " + initialSystemBrightness +
                    " (raw: " + systemBrightness + "/255)");
        } catch (Exception e) {
            Log.w(TAG, "Error caching system brightness, using default", e);
            initialSystemBrightness = DEFAULT_BRIGHTNESS_NORMALIZED;
            brightnessInitialized = true;
        }
    }

    /**
     * Manually caches the current system brightness.
     * 
     * <p>
     * <b>NOTE:</b> This is <b>OPTIONAL</b> - {@link #startListening()} already
     * calls this automatically. Only use this if you need to update the cached
     * value mid-session (rare).
     * </p>
     * 
     * @param promise Promise resolving to brightness data
     */
    @ReactMethod
    public void saveInitialBrightness(Promise promise) {
        try {
            cacheSystemBrightness();

            WritableMap result = Arguments.createMap();
            result.putDouble("brightness", initialSystemBrightness);
            result.putBoolean("success", brightnessInitialized);
            promise.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Error in saveInitialBrightness", e);
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Sets app brightness (0.0 to 1.0).
     * 
     * <p>
     * This only affects the current activity's window, not system brightness.
     * The change is temporary and will be reset when the video player closes.
     * </p>
     * 
     * @param brightness Brightness level (0.0 = black, 1.0 = full)
     * @param promise    Promise resolving to the set brightness value
     */
    @ReactMethod
    public void setBrightness(float brightness, Promise promise) {
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

                Log.d(TAG, "Brightness set to: " + finalBrightness);
                promise.resolve(finalBrightness);
            } catch (Exception e) {
                Log.e(TAG, "Error setting brightness", e);
                promise.reject("ERROR", e.getMessage());
            }
        });
    }

    /**
     * Fast synchronous brightness setter for gesture performance.
     * 
     * <p>
     * Fire-and-forget version of {@link #setBrightness(float, Promise)}
     * optimized for rapid gesture updates.
     * </p>
     * 
     * @param brightness Brightness level (0.0 to 1.0)
     */
    @ReactMethod
    public void setBrightnessSync(float brightness) {
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
                Log.e(TAG, "Error in setBrightnessSync", e);
            }
        });
    }

    /**
     * Gets current window brightness.
     * 
     * <p>
     * Returns the app's window brightness, or system brightness if using default.
     * </p>
     * 
     * @param promise Promise resolving to brightness value (0.0 to 1.0)
     */
    @ReactMethod
    public void getBrightness(Promise promise) {
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
                    if (contentResolver != null) {
                        int systemBrightness = Settings.System.getInt(
                                contentResolver,
                                Settings.System.SCREEN_BRIGHTNESS,
                                DEFAULT_BRIGHTNESS_VALUE);
                        brightness = systemBrightness / 255f;
                    } else {
                        brightness = DEFAULT_BRIGHTNESS_NORMALIZED;
                    }
                }

                promise.resolve(brightness);
            } catch (Exception e) {
                Log.e(TAG, "Error getting brightness", e);
                promise.reject("ERROR", e.getMessage());
            }
        });
    }

    /**
     * Resets brightness to cached system default.
     * 
     * <p>
     * <b>Custom ROM Compatibility (iQOO, MIUI, etc.):</b>
     * </p>
     * <ul>
     * <li><b>Primary:</b> Uses cached brightness from
     * {@link #cacheSystemBrightness()}</li>
     * <li><b>Fallback 1:</b> Reads current system brightness</li>
     * <li><b>Fallback 2:</b> Uses -1 (system default flag)</li>
     * </ul>
     * 
     * <p>
     * This multi-layer approach ensures reliable brightness restoration even
     * on heavily customized Android skins.
     * </p>
     * 
     * @param promise Promise resolving to true on success
     */
    @ReactMethod
    public void resetBrightness(Promise promise) {
        android.app.Activity activity = getCurrentActivity();
        if (activity == null) {
            promise.reject("ERROR", "No activity available");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                android.view.WindowManager.LayoutParams params = activity.getWindow().getAttributes();

                // PRIMARY: Use cached system brightness
                if (brightnessInitialized && initialSystemBrightness >= 0) {
                    Log.i(TAG, "Resetting to cached brightness: " + initialSystemBrightness);
                    params.screenBrightness = initialSystemBrightness;
                } else {
                    // FALLBACK 1: Read current system brightness
                    if (contentResolver != null) {
                        int systemBrightness = Settings.System.getInt(
                                contentResolver,
                                Settings.System.SCREEN_BRIGHTNESS,
                                DEFAULT_BRIGHTNESS_VALUE);
                        float normalizedBrightness = systemBrightness / 255f;

                        // FALLBACK 2: Use -1 if invalid value
                        if (normalizedBrightness <= 0) {
                            Log.w(TAG, "System brightness invalid, using -1 fallback");
                            params.screenBrightness = -1f;
                        } else {
                            Log.i(TAG, "Resetting to current system brightness: " + normalizedBrightness);
                            params.screenBrightness = normalizedBrightness;
                        }
                    } else {
                        Log.w(TAG, "No ContentResolver, using -1 fallback");
                        params.screenBrightness = -1f;
                    }
                }

                activity.getWindow().setAttributes(params);

                // VERIFICATION (for stubborn ROMs like iQOO)
                // Double-check after delay and retry if needed
                mainHandler.postDelayed(() -> verifyBrightnessReset(activity), BRIGHTNESS_RESET_DELAY_MS);

                promise.resolve(true);
            } catch (Exception e) {
                Log.e(TAG, "Error resetting brightness", e);
                promise.reject("ERROR", e.getMessage());
            }
        });
    }

    /**
     * Verifies brightness was reset correctly and retries if needed.
     * 
     * <p>
     * Some custom ROMs (iQOO, etc.) may ignore the first brightness change.
     * This verification step catches and fixes that.
     * </p>
     * 
     * @param activity The current activity
     */
    private void verifyBrightnessReset(android.app.Activity activity) {
        if (activity == null || !brightnessInitialized || initialSystemBrightness < 0) {
            return;
        }

        try {
            android.view.WindowManager.LayoutParams params = activity.getWindow().getAttributes();
            float currentBrightness = params.screenBrightness;
            float delta = Math.abs(currentBrightness - initialSystemBrightness);

            if (delta > BRIGHTNESS_CHANGE_THRESHOLD) {
                Log.w(TAG, "Brightness reset verification failed (delta: " + delta + "), retrying...");
                params.screenBrightness = initialSystemBrightness;
                activity.getWindow().setAttributes(params);
            } else {
                Log.d(TAG, "Brightness reset verified successfully");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in brightness verification", e);
        }
    }

    /**
     * Synchronous version of {@link #resetBrightness(Promise)}.
     * 
     * <p>
     * Used for cleanup in lifecycle events where promises aren't needed.
     * </p>
     */
    @ReactMethod
    public void resetBrightnessSync() {
        android.app.Activity activity = getCurrentActivity();
        if (activity == null) {
            Log.w(TAG, "Cannot reset brightness: no activity");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                android.view.WindowManager.LayoutParams params = activity.getWindow().getAttributes();

                if (brightnessInitialized && initialSystemBrightness >= 0) {
                    params.screenBrightness = initialSystemBrightness;
                    Log.d(TAG, "Brightness reset (sync) to: " + initialSystemBrightness);
                } else if (contentResolver != null) {
                    int systemBrightness = Settings.System.getInt(
                            contentResolver,
                            Settings.System.SCREEN_BRIGHTNESS,
                            DEFAULT_BRIGHTNESS_VALUE);
                    float normalizedBrightness = systemBrightness / 255f;

                    if (normalizedBrightness > 0) {
                        params.screenBrightness = normalizedBrightness;
                    } else {
                        params.screenBrightness = -1f;
                    }
                } else {
                    params.screenBrightness = -1f;
                }

                activity.getWindow().setAttributes(params);
            } catch (Exception e) {
                Log.e(TAG, "Error in resetBrightnessSync", e);
            }
        });
    }
}