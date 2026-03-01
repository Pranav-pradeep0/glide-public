import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { NativeModules, DeviceEventEmitter, EmitterSubscription } from 'react-native';
import { SharedValue, useSharedValue } from 'react-native-reanimated';

const { AudioControlModule } = NativeModules;

export type AudioRouteType = 'speaker' | 'bluetooth' | 'wired' | 'usb' | 'unknown';

interface AudioRoute {
    type: AudioRouteType;
    maxVolume: number; // 100 for speaker, 200 for external
}

interface UseAudioControllerReturn {
    // Current volume (0-200 range)
    volume: number;

    // Limits
    maxVolume: number; // 1.0 or 2.0 (normalized)

    // Current audio route
    audioRoute: AudioRoute;

    // Shared value for gesture integration (0-2 range for UI/Gestures)
    currentVolumeShared: SharedValue<number>;

    // Apply volume (normalized 0-2)
    applyVolume: (normalizedValue: number, fromGesture?: boolean) => void;

    // Set volume manually (0-200)
    setVolume: (value: number) => void;

    // Notify gesture ended (syncs React state)
    onGestureEnd: () => void;
}

/**
 * Audio Controller Hook
 *
 * Uses the custom AudioControlModule native module for:
 * - System volume control (0-100%)
 * - VLC boost control (100-200%)
 * - Audio route detection
 * - Hardware button listening
 *
 * Designed for smooth gesture-driven volume control.
 */
export function useAudioController(
    vlcRef: React.RefObject<any>,
    initialVolume: number = 100,
    onHardwareVolumeChange?: (volume: number) => void
): UseAudioControllerReturn {
    // Volume state per route (session persistence)
    const [volumePerRoute, setVolumePerRoute] = useState<{ [key: string]: number }>({
        speaker: 100,
        bluetooth: 100,
        wired: 100,
        usb: 100,
        unknown: 100,
    });

    const [audioRoute, setAudioRoute] = useState<AudioRoute>({
        type: 'speaker',
        maxVolume: 100,
    });

    const [volume, setVolumeState] = useState(initialVolume);

    // Shared value for Reanimated (gestures) - normalized 0-2 (0-200%)
    const currentVolumeShared = useSharedValue(initialVolume / 100);

    // Guard to track if gesture is active (prevents hardware events during swipes)
    const isGestureActiveRef = useRef(false);

    // Track the last volume we set to ignore quantized feedback from system
    // System volume has discrete steps, so 56% might become 53% - we should ignore this
    const lastSetVolumeRef = useRef(initialVolume);
    const lastSetTimeRef = useRef(0);

    // Initialize and start listening
    useEffect(() => {
        if (!AudioControlModule) {
            if (__DEV__) {console.warn('[AudioController] AudioControlModule not available');}
            return;
        }

        // Get initial route and volume
        AudioControlModule.getCurrentRoute().then((result: any) => {
            setAudioRoute({
                type: result.route as AudioRouteType,
                maxVolume: result.maxVolume,
            });
        });

        AudioControlModule.getVolume().then((result: any) => {
            const percentage = result.volume;
            currentVolumeShared.value = percentage / 100;
            setVolumeState(percentage);

            // Sync all routes to initial volume
            setVolumePerRoute({
                speaker: percentage,
                bluetooth: percentage,
                wired: percentage,
                usb: percentage,
                unknown: percentage,
            });
        });

        // Start native listeners
        AudioControlModule.startListening();

        return () => {
            AudioControlModule.stopListening();
        };
    }, []);

    // Listen for hardware volume changes (from physical buttons)
    useEffect(() => {
        const subscription: EmitterSubscription = DeviceEventEmitter.addListener(
            'onVolumeChange',
            (event) => {
                // Ignore if gesture is active
                if (isGestureActiveRef.current) {
                    return;
                }

                const { volume: newVolume, fromHardware } = event;

                if (fromHardware) {
                    const now = Date.now();
                    const timeSinceLastSet = now - lastSetTimeRef.current;

                    // Ignore events within 300ms of our last set (system quantization feedback)
                    if (timeSinceLastSet < 300) {
                        return;
                    }

                    // Ignore if the value is within 5% of what we last set (quantization)
                    const diff = Math.abs(newVolume - lastSetVolumeRef.current);
                    if (diff <= 5) {
                        return;
                    }

                    // This is a genuine hardware button press - sync our state
                    const normalized = newVolume / 100;
                    currentVolumeShared.value = normalized;
                    setVolumeState(newVolume);
                    lastSetVolumeRef.current = newVolume;
                    lastSetTimeRef.current = now;

                    // Update VLC (hardware changes are 0-100%, so VLC at unity)
                    if (vlcRef.current?.setVolume) {
                        vlcRef.current.setVolume(100);
                        lastVlcVolumeRef.current = 100;
                    }

                    // Update route history
                    setVolumePerRoute(prev => ({
                        ...prev,
                        [audioRoute.type]: newVolume,
                    }));

                    // Trigger HUD display via callback
                    if (onHardwareVolumeChange) {
                        onHardwareVolumeChange(newVolume);
                    }
                }
            }
        );

        return () => {
            subscription.remove();
        };
    }, [audioRoute.type]); // Removed vlcRef and onHardwareVolumeChange (stable or ref-based)

    // Listen for route changes
    useEffect(() => {
        const subscription: EmitterSubscription = DeviceEventEmitter.addListener(
            'onAudioRouteChange',
            (event) => {
                const { route, previousRoute, maxVolume } = event;
                const newRouteType = route as AudioRouteType;

                if (__DEV__) {console.log(`[AudioController] Route changed: ${previousRoute} -> ${route} (Max: ${maxVolume})`);}

                setAudioRoute({
                    type: newRouteType,
                    maxVolume: maxVolume,
                });

                // Get saved volume for this route, clamped to new max
                setVolumePerRoute(prev => {
                    const savedVolume = prev[newRouteType] ?? 100;
                    const targetVolume = Math.min(savedVolume, maxVolume);
                    const normalized = targetVolume / 100;

                    currentVolumeShared.value = normalized;
                    setVolumeState(targetVolume);

                    // Apply immediately
                    AudioControlModule.setVolume(Math.min(targetVolume, 100));

                    if (targetVolume <= 100) {
                        if (vlcRef.current?.setVolume) {vlcRef.current.setVolume(100);}
                    } else {
                        if (vlcRef.current?.setVolume) {vlcRef.current.setVolume(targetVolume);}
                    }

                    return prev;
                });
            }
        );

        return () => {
            subscription.remove();
        };
    }, [vlcRef]);

    // Track last VLC volume to avoid redundant native calls
    const lastVlcVolumeRef = useRef(100);

    // Refs for stable callback access
    const audioRouteRef = useRef(audioRoute);
    const vlcRefInternal = useRef(vlcRef.current);

    useEffect(() => {
        audioRouteRef.current = audioRoute;
    }, [audioRoute]);

    useEffect(() => {
        vlcRefInternal.current = vlcRef.current;
    }, [vlcRef.current]);


    // Apply volume (called during gestures and manual sets)
    // STABLE CALLBACK: Uses refs to avoid recreation and stale closures
    const applyVolume = useCallback((normalizedValue: number, fromGesture: boolean = false) => {
        if (!AudioControlModule) {return;}

        // Mark gesture active
        if (fromGesture) {
            isGestureActiveRef.current = true;
        }

        // Clamp based on route
        let effectiveValue = normalizedValue;
        const currentRoute = audioRouteRef.current;
        const routeMaxNormal = currentRoute.maxVolume / 100;

        // Speaker protection
        if (currentRoute.type === 'speaker' && effectiveValue > 1.0) {
            effectiveValue = 1.0;
        }

        // Clamp to route max
        effectiveValue = Math.max(0, Math.min(effectiveValue, routeMaxNormal));

        // Convert to percentage (0-200)
        const percentage = Math.round(effectiveValue * 100);

        // Track what we're setting for quantization filtering
        lastSetVolumeRef.current = percentage;
        lastSetTimeRef.current = Date.now();

        // Set system volume
        const systemPercentage = Math.min(percentage, 100);

        // Use sync method during gestures for better performance (no promise overhead)
        try {
            if (fromGesture && AudioControlModule.setVolumeSync) {
                AudioControlModule.setVolumeSync(systemPercentage);
            } else {
                AudioControlModule.setVolume(systemPercentage).catch((err: any) => {
                    if (__DEV__) {console.warn('[AudioController] setVolume error:', err);}
                });
            }
        } catch (error) {
            if (__DEV__) {console.warn('[AudioController] Native setVolume failed:', error);}
        }

        // Handle VLC boost for 100-200%
        // OPTIMIZATION: Only update VLC when the value actually changes
        const targetVlcVolume = percentage <= 100 ? 100 : percentage;
        if (targetVlcVolume !== lastVlcVolumeRef.current) {
            lastVlcVolumeRef.current = targetVlcVolume;
            if (vlcRefInternal.current?.setVolume) {
                vlcRefInternal.current.setVolume(targetVlcVolume);
            }
        }

        // Skip React state updates during gesture for smoothness
        // State will sync on gesture end
        if (!fromGesture) {
            setVolumeState(percentage);
            setVolumePerRoute(prev => ({
                ...prev,
                [currentRoute.type]: percentage,
            }));
        }

    }, []);

    // Set volume (0-200 range)
    const setVolume = useCallback((val: number) => {
        applyVolume(val / 100);
    }, [applyVolume]);

    // Called when gesture ends - syncs React state
    const onGestureEnd = useCallback(() => {
        const finalVolume = Math.round(currentVolumeShared.value * 100);
        setVolumeState(finalVolume);
        setVolumePerRoute(prev => ({
            ...prev,
            [audioRoute.type]: finalVolume,
        }));

        // Update tracking to prevent quantized feedback from overriding
        lastSetVolumeRef.current = finalVolume;
        lastSetTimeRef.current = Date.now();

        // Clear gesture guard after a delay (allow system feedback to pass)
        setTimeout(() => {
            isGestureActiveRef.current = false;
        }, 300);
    }, [audioRoute.type]);

    return useMemo(() => ({
        volume,
        maxVolume: audioRoute.maxVolume / 100, // Normalized 1.0 or 2.0
        audioRoute,
        currentVolumeShared,
        applyVolume,
        setVolume,
        onGestureEnd,
    }), [
        volume,
        audioRoute,
        currentVolumeShared,
        applyVolume,
        setVolume,
        onGestureEnd,
    ]);
}

