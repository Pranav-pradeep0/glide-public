package com.yuanzhou.vlc.vlcplayer;

import android.util.Log;

final class VlcAdjustBridge {
    private static final String TAG = "VlcAdjustBridge";

    private static final float ENHANCED_BRIGHTNESS = 1.03f;
    private static final float ENHANCED_CONTRAST = 1.08f;
    private static final float ENHANCED_SATURATION = 1.30f;
    private static final float ENHANCED_GAMMA = 0.95f;

    private static boolean sLibraryLoaded = false;
    private static boolean sLoadAttempted = false;

    private VlcAdjustBridge() {}

    private static synchronized boolean ensureLibraryLoaded() {
        if (sLoadAttempted) {
            return sLibraryLoaded;
        }
        sLoadAttempted = true;
        try {
            System.loadLibrary("glide_vlc_adjust_bridge");
            sLibraryLoaded = true;
        } catch (UnsatisfiedLinkError error) {
            Log.e(TAG, "Failed to load glide_vlc_adjust_bridge", error);
            sLibraryLoaded = false;
        }
        return sLibraryLoaded;
    }

    static boolean isAvailable() {
        return ensureLibraryLoaded() && nativeIsAvailable();
    }

    static boolean applyEnhancement(long mediaPlayerHandle, boolean enabled) {
        if (!ensureLibraryLoaded()) {
            Log.w(TAG, "applyEnhancement skipped: JNI library unavailable");
            return false;
        }
        return nativeApplyEnhancement(
                mediaPlayerHandle,
                enabled,
                ENHANCED_BRIGHTNESS,
                ENHANCED_CONTRAST,
                ENHANCED_SATURATION,
                ENHANCED_GAMMA
        );
    }

    private static native boolean nativeIsAvailable();

    private static native boolean nativeApplyEnhancement(
            long mediaPlayerHandle,
            boolean enabled,
            float brightness,
            float contrast,
            float saturation,
            float gamma
    );
}
