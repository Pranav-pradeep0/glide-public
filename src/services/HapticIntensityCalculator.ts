import { HapticSettings } from '../types';
import { AMPLITUDE_RANGE } from '../utils/constants';

/**
 * Service for calculating haptic intensities based on user's intensity setting.
 * The user's intensity value (1-255) represents their desired max amplitude.
 * Pattern amplitudes are scaled proportionally to reach this target.
 */
export class HapticIntensityCalculator {
    // Default max amplitude that patterns are designed for
    private static readonly DESIGN_MAX_AMPLITUDE = 255;

    /**
     * Calculates the final intensity for a haptic pattern.
     * Maps the base intensity to the user's desired intensity range.
     *
     * @param baseIntensity - The base intensity for the haptic category (designed for 0-30 range)
     * @param hapticSettings - User's haptic settings from store
     * @returns Final calculated intensity (1-255)
     */
    static calculateIntensity(
        baseIntensity: number,
        hapticSettings: HapticSettings
    ): number {
        // User's intensity IS the target max amplitude
        // Scale base intensity proportionally
        const userMaxAmplitude = hapticSettings.intensity;
        const scaleFactor = userMaxAmplitude / this.DESIGN_MAX_AMPLITUDE;
        const intensity = baseIntensity * scaleFactor;

        // Clamp to valid amplitude range (1-255)
        return Math.max(
            AMPLITUDE_RANGE.MIN + 1,
            Math.min(AMPLITUDE_RANGE.MAX, Math.round(intensity))
        );
    }

    /**
     * Scales an entire waveform's amplitudes based on user's intensity setting.
     * The user's intensity value becomes the target max amplitude.
     *
     * @param amplitudes - Original amplitude array (designed for 0-30 range)
     * @param hapticSettings - User's haptic settings
     * @returns Scaled amplitude array (targeting user's intensity as max)
     */
    static scaleWaveformAmplitudes(
        amplitudes: number[],
        hapticSettings: HapticSettings
    ): number[] {
        // User's intensity IS the target max amplitude
        const userMaxAmplitude = hapticSettings.intensity;
        const scaleFactor = userMaxAmplitude / this.DESIGN_MAX_AMPLITUDE;

        return amplitudes.map(amplitude => {
            const scaled = amplitude * scaleFactor;
            return Math.max(1, Math.min(255, Math.round(scaled)));
        });
    }
}
