package com.glide.app.haptic;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;

public class HapticModule extends ReactContextBaseJavaModule {
    private final Vibrator vibrator;

    public HapticModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.vibrator = (Vibrator) reactContext.getSystemService(Context.VIBRATOR_SERVICE);
    }

    @Override
    public String getName() {
        return "HapticModule";
    }

    /**
     * Vibrates with specified amplitude for a duration
     * 
     * @param duration  Duration in milliseconds
     * @param amplitude Amplitude from 1-255 (0 = default)
     */
    @ReactMethod
    public void vibrate(int duration, int amplitude) {
        if (vibrator == null || !vibrator.hasVibrator()) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Android 8.0+ - Use VibrationEffect with amplitude control
            int clampedAmplitude = Math.max(1, Math.min(255, amplitude));
            VibrationEffect effect = VibrationEffect.createOneShot(duration, clampedAmplitude);
            vibrator.vibrate(effect);
        } else {
            // Fallback for older Android versions
            vibrator.vibrate(duration);
        }
    }

    /**
     * Vibrates with a waveform pattern
     * 
     * @param timings    Array of timing values [delay, duration, delay, duration,
     *                   ...]
     * @param amplitudes Array of amplitude values (0-255) corresponding to timings
     */
    @ReactMethod
    public void vibrateWaveform(ReadableArray timings, ReadableArray amplitudes) {
        if (vibrator == null || !vibrator.hasVibrator()) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Convert ReadableArray to primitive arrays
            long[] timingsArray = new long[timings.size()];
            int[] amplitudesArray = new int[amplitudes.size()];

            for (int i = 0; i < timings.size(); i++) {
                timingsArray[i] = (long) timings.getDouble(i);
            }

            for (int i = 0; i < amplitudes.size(); i++) {
                int amp = amplitudes.getInt(i);
                amplitudesArray[i] = Math.max(0, Math.min(255, amp));
            }

            VibrationEffect effect = VibrationEffect.createWaveform(timingsArray, amplitudesArray, -1);
            vibrator.vibrate(effect);
        } else {
            // Fallback for older versions - just use timings
            long[] timingsArray = new long[timings.size()];
            for (int i = 0; i < timings.size(); i++) {
                timingsArray[i] = (long) timings.getDouble(i);
            }
            vibrator.vibrate(timingsArray, -1);
        }
    }

    /**
     * Cancels all ongoing vibrations
     */
    @ReactMethod
    public void cancel() {
        if (vibrator != null) {
            vibrator.cancel();
        }
    }

    /**
     * Checks if device supports amplitude control
     * 
     * @return true if Android 8.0+ and has vibrator
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    public boolean hasAmplitudeControl() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                vibrator != null &&
                vibrator.hasVibrator();
    }
}
