import { Platform, Vibration } from 'react-native';
import HapticModule from '../native/HapticModule';
import { HapticPattern } from '../types/hapticTypes';

export class HapticEngineService {
    private static instance: HapticEngineService;
    private isEnabled: boolean = true;
    private lastTriggerTime: number = 0;
    private currentPriority: number = 0;
    private hasAmplitudeControl: boolean = false;

    // Configuration - 400ms throttle balances responsiveness with battery life
    private readonly MIN_INTERVAL_MS = 400;

    private constructor() {
        this.checkDeviceCapabilities();
    }

    static getInstance(): HapticEngineService {
        if (!HapticEngineService.instance) {
            HapticEngineService.instance = new HapticEngineService();
        }
        return HapticEngineService.instance;
    }

    /**
     * Checks if the device supports amplitude control
     */
    private checkDeviceCapabilities() {
        if (Platform.OS === 'android' && HapticModule) {
            try {
                this.hasAmplitudeControl = HapticModule.hasAmplitudeControl();
                if (__DEV__) {
                    if (__DEV__) {console.log('[HapticEngine] Amplitude control:', this.hasAmplitudeControl);}
                }
            } catch (error) {
                if (__DEV__) {
                    console.warn('[HapticEngine] Could not check amplitude control:', error);
                }
                this.hasAmplitudeControl = false;
            }
        }
    }

    public setEnabled(enabled: boolean) {
        this.isEnabled = enabled;
        if (!enabled) {
            this.cancelAll();
        }
    }

    /**
     * Triggers a discrete UI feedback haptic (bypasses some throttling)
     */
    public triggerUIFeedback(type: 'light' | 'medium' | 'heavy' | 'success' | 'error') {
        const specs = {
            light: { duration: 10, intensity: 40 },
            medium: { duration: 20, intensity: 80 },
            heavy: { duration: 40, intensity: 150 },
            success: { duration: 30, intensity: 100 },
            error: { duration: 50, intensity: 200 },
        }[type];

        if (Platform.OS === 'android' && this.hasAmplitudeControl && HapticModule) {
            HapticModule.vibrate(specs.duration, specs.intensity);
        } else {
            // Fallback for devices without amplitude or iOS (basic vibration)
            Vibration.vibrate(specs.duration);
        }
    }

    public cancelAll() {
        if (Platform.OS === 'android' && HapticModule) {
            try {
                HapticModule.cancel();
            } catch (error) {
                Vibration.cancel();
            }
        } else {
            Vibration.cancel();
        }
        this.currentPriority = 0;
    }

    /**
     * Triggers a haptic pattern if it meets priority and timing constraints
     */
    public triggerHaptic(pattern: HapticPattern) {
        if (!this.isEnabled) {return;}

        const now = Date.now();

        // 1. Throttling check
        if (now - this.lastTriggerTime < this.MIN_INTERVAL_MS) {
            // Only override if significantly higher priority
            if (pattern.priority <= this.currentPriority + 2) {
                return;
            }
        }

        // 2. Priority check
        if (pattern.priority < this.currentPriority) {
            return;
        }

        // 3. Execute Haptic
        this.playPattern(pattern);

        // 4. Update State
        this.lastTriggerTime = now;
        this.currentPriority = pattern.priority;

        // Reset priority after duration
        setTimeout(() => {
            if (this.currentPriority === pattern.priority) {
                this.currentPriority = 0;
            }
        }, pattern.duration);
    }

    private playPattern(pattern: HapticPattern) {
        if (__DEV__) {
            if (__DEV__) {console.log(`[HapticEngine] Playing: ${pattern.soundEffect} (${pattern.category}), intensity: ${pattern.intensity}, duration: ${pattern.duration}ms`);}
        }

        if (Platform.OS === 'android' && this.hasAmplitudeControl && HapticModule) {
            try {
                // Use waveform for patterned categories
                if (pattern.waveform && pattern.category !== 'impact') {
                    if (__DEV__) {
                        if (__DEV__) {console.log(`[HapticEngine] Using waveform with ${pattern.waveform.timings.length} steps`);}
                    }
                    HapticModule.vibrateWaveform(
                        pattern.waveform.timings,
                        pattern.waveform.amplitudes
                    );
                } else {
                    // Simple vibration for impact
                    HapticModule.vibrate(pattern.duration, pattern.intensity);
                }
            } catch (error) {
                if (__DEV__) {
                    console.warn('[HapticEngine] Native vibrate failed:', error);
                }
                this.fallbackVibration(pattern);
            }
        } else {
            this.fallbackVibration(pattern);
        }
    }

    private fallbackVibration(pattern: HapticPattern) {
        // Simple vibration using basic Vibration API (no amplitude control)
        const clampedDuration = Math.min(pattern.duration, 2000);
        Vibration.vibrate(clampedDuration);
    }
}


