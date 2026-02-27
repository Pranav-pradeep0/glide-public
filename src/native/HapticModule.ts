// @native/HapticModule

import { NativeModules } from 'react-native';

interface HapticModuleInterface {
    /**
     * Vibrates with specified amplitude for a duration
     * @param duration Duration in milliseconds
     * @param amplitude Amplitude from 1-255 (higher = stronger)
     */
    vibrate(duration: number, amplitude: number): void;

    /**
     * Vibrates with a waveform pattern
     * @param timings Array of timing values [delay, duration, delay, duration, ...]
     * @param amplitudes Array of amplitude values (0-255) corresponding to timings
     */
    vibrateWaveform(timings: number[], amplitudes: number[]): void;

    /**
     * Cancels all ongoing vibrations
     */
    cancel(): void;

    /**
     * Checks if device supports amplitude control
     */
    hasAmplitudeControl(): boolean;
}

const { HapticModule } = NativeModules;

if (!HapticModule) {
    console.error('[HapticModule] Native module not found. Make sure you registered HapticPackage in MainApplication.java');
}

export default HapticModule as HapticModuleInterface;
