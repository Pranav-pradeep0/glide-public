/**
 * usePlayerGestures Hook
 * 
 * Main gesture compositor for the video player.
 * Combines all gesture sub-hooks into a single composed gesture.
 * Also provides the animated style for video zoom/pan.
 * 
 * CRITICAL: This hook orchestrates all gesture handling.
 * Changes here can break the entire gesture system.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useWindowDimensions, NativeModules } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
    useSharedValue,
    useAnimatedStyle,
    SharedValue,
    runOnJS,
} from 'react-native-reanimated';

const { AudioControlModule } = NativeModules;

import { UsePlayerCoreReturn, UsePlayerUIReturn, UsePlayerHUDReturn } from './types';
import { useSeekGesture } from './useSeekGesture';
import { useBrightnessGesture } from './useBrightnessGesture';
import { useVolumeGesture } from './useVolumeGesture';
import { useSpeedGesture } from './useSpeedGesture';
import { useZoomGesture } from './useZoomGesture';
import { useTapGestures } from './useTapGestures';

// ============================================================================
// TYPES
// ============================================================================

interface UsePlayerGesturesOptions {
    player: UsePlayerCoreReturn;
    ui: UsePlayerUIReturn;
    hud: UsePlayerHUDReturn;

    // Optional callbacks
    onSeekUpdate?: (time: number, show: boolean) => void;
    onBrightnessChange?: (value: number) => void;
    onBrightnessSave?: (value: number) => void;
    initialBrightness?: number;
}

interface UsePlayerGesturesReturn {
    // The composed gesture to use with GestureDetector
    composedGesture: ReturnType<typeof Gesture.Race>;

    // Animated style for the video container (handles zoom/pan transforms)
    videoAnimatedStyle: ReturnType<typeof useAnimatedStyle>;

    // Shared values exposed for UI consumption (VideoHUD)
    sharedValues: {
        zoomActive: SharedValue<boolean>;
        pinchScale: SharedValue<number>;
        currentBrightness: SharedValue<number>;
        currentVolume: SharedValue<number>;
        seekTime: SharedValue<number>;
    };

    // Current volume max (100 or 200)
    maxVolume: number;

    // Helper to reset zoom
    resetZoom: () => void;


}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Main gesture hook that composes all gesture handlers.
 * 
 * Gesture priority (using Race and Exclusive combiners):
 * 1. Pinch (zoom) - highest priority
 * 2. Speed gestures (long press) - need to activate before pan
 * 3. Tap gestures (single/double) - should work everywhere
 * 4. Pan gestures (seek, brightness, volume, zoom-pan) - fallback
 */
import { useAudioController } from './useAudioController';

// ...

export function usePlayerGestures(options: UsePlayerGesturesOptions): UsePlayerGesturesReturn {
    const { player, ui, hud, onSeekUpdate, initialBrightness, onBrightnessChange, onBrightnessSave } = options;

    const { width, height } = useWindowDimensions();

    // ========================================================================
    // AUDIO CONTROLLER
    // ========================================================================

    // Callback for hardware volume button presses - show volume HUD
    const handleHardwareVolumeChange = useCallback((volume: number) => {
        // Show HUD with isGestureActive=false so it auto-hides
        hud.showVolumeHUD(volume / 100, false);
    }, [hud]);

    // Initialize Audio Controller (Hybrid System+VLC logic)
    const audioController = useAudioController(player.videoRef, 100, handleHardwareVolumeChange);

    // ========================================================================
    // SHARED VALUES FOR GESTURES
    // ========================================================================

    // Seek gesture
    const seekStartTime = useSharedValue(0);
    const seekOffset = useSharedValue(0);
    const gestureActive = useSharedValue(false);
    // New: dedicated shared value for the calculated seek time (for HUD)
    const seekTimeShared = useSharedValue(0);

    // Brightness gesture
    const currentBrightness = useSharedValue(initialBrightness ?? 0.5);
    const brightnessStart = useSharedValue(initialBrightness ?? 0.5);

    // Volume gesture - Use shared value from controller
    const currentVolume = audioController.currentVolumeShared;
    const volumeStart = useSharedValue(0.5);

    // Speed gesture
    const speedBase = useSharedValue(2.0);
    const speedGestureActive = useSharedValue(false);
    const lastSpeedUpdate = useSharedValue(2.0);

    // Zoom gesture
    const pinchScale = useSharedValue(1);
    const pinchScaleStart = useSharedValue(1);
    const panX = useSharedValue(0);
    const panY = useSharedValue(0);
    const panStartX = useSharedValue(0);
    const panStartY = useSharedValue(0);
    const zoomActive = useSharedValue(false);

    // ========================================================================
    // SCREEN ZONES
    // ========================================================================

    const leftZoneWidth = useMemo(() => width * 0.15, [width]);
    const rightZoneWidth = useMemo(() => width * 0.15, [width]);



    // ========================================================================
    // SYSTEM INTEGRATIONS
    // ========================================================================

    const setBrightnessNative = useCallback((val: number, isFinal: boolean = false) => {
        const brightness = Math.max(0, Math.min(1, val));
        // Use sync method for smooth gesture performance
        if (AudioControlModule?.setBrightnessSync) {
            AudioControlModule.setBrightnessSync(brightness);
        } else {
            AudioControlModule?.setBrightness(brightness).catch(() => { });
        }

        // Notify JS callback for persistence
        if (onBrightnessChange) {
            runOnJS(onBrightnessChange)(brightness);
        }

        if (isFinal && onBrightnessSave) {
            runOnJS(onBrightnessSave)(brightness);
        }
    }, [onBrightnessChange, onBrightnessSave]);

    // NOTE: setVolumeNative is removed in favor of audioController.applyVolume

    // Initialize brightness from system
    useEffect(() => {
        const init = async () => {
            try {
                if (initialBrightness !== undefined) {
                    currentBrightness.value = initialBrightness;
                    if (onBrightnessChange) onBrightnessChange(initialBrightness);

                    if (AudioControlModule) {
                        if (AudioControlModule.setBrightnessSync) {
                            AudioControlModule.setBrightnessSync(initialBrightness);
                        } else {
                            AudioControlModule.setBrightness(initialBrightness);
                        }
                    }
                } else if (AudioControlModule) {
                    const deviceBrightness = await AudioControlModule.getBrightness();
                    currentBrightness.value = Math.max(0, Math.min(1, typeof deviceBrightness === 'number' ? deviceBrightness : 0.5));
                }
            } catch (err) {
                if (initialBrightness === undefined) {
                    currentBrightness.value = 0.5;
                }
            }
            // Volume initialization is handled inside useAudioController now
        };
        init();
    }, [currentBrightness, initialBrightness]);

    // ========================================================================
    // ZOOM HELPERS
    // ========================================================================

    const resetZoom = useCallback(() => {
        pinchScale.value = 1;
        panX.value = 0;
        panY.value = 0;
        zoomActive.value = false;
        hud.updateZoom(1);
    }, [pinchScale, panX, panY, zoomActive, hud]);

    // ========================================================================
    // GESTURE CALLBACKS
    // ========================================================================

    // Seek
    const handleSeekStart = useCallback(() => {
        // Capture initial time when seek begins (for difference display)
        hud.setSeekStartTime(player.currentTimeRef.current);
        // Sync shared value
        seekTimeShared.value = player.currentTimeRef.current;
        // Show seeker immediately with current time, gesture active = true
        hud.showSeekHUD(player.currentTimeRef.current, null, null, true);
    }, [hud, player, seekTimeShared]);

    const handleSeekUpdate = useCallback((time: number) => {
        // Update player position and show HUD with gesture active
        player.seek(time);
        hud.showSeekHUD(time, null, null, true);
        onSeekUpdate?.(time, true);
    }, [player, hud, onSeekUpdate]);

    const handleSeekComplete = useCallback((time: number) => {
        player.seekImmediate(time);
        // Show final time with auto-hide (isGestureActive=false)
        hud.showSeekHUD(time, null, null, false);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [player, hud, ui]);

    // Lock tap
    const handleLockTap = useCallback(() => {
        ui.showLockIconTemporarily();
    }, [ui]);

    // Brightness
    const handleBrightnessChange = useCallback((value: number) => {
        // Only show HUD container, value is via shared value
        hud.showBrightnessHUD(value, true);
    }, [hud]);

    const handleBrightnessEnd = useCallback(() => {
        // Signal gesture end to start auto-hide timer
        // We pass current value to keep state consistent, though visual is shared-value driven
        hud.showBrightnessHUD(currentBrightness.value, false);
    }, [hud, currentBrightness]);

    // Volume
    const handleVolumeChange = useCallback((value: number) => {
        // Pass audio route type to HUD if needed (not yet implemented in HUD API)
        hud.showVolumeHUD(value, true);
    }, [hud]);

    const handleVolumeEnd = useCallback(() => {
        hud.showVolumeHUD(currentVolume.value, false);
        audioController.onGestureEnd(); // Clear the gesture guard
    }, [hud, currentVolume, audioController]);

    // Speed
    const handleSpeedChange = useCallback((rate: number, isGestureActive?: boolean) => {
        hud.showSpeedHUD(rate, isGestureActive);
    }, [hud]);

    const handleSpeedReset = useCallback(() => {
        // hud.resetSpeed() hides immediately. 
        // We want to show "1.00x" and let it auto-hide naturally.
        hud.showSpeedHUD(1.0, false);
    }, [hud]);

    // Zoom
    const handleZoomStart = useCallback(() => {
        ui.hideControls();
    }, [ui]);

    const handleZoomUpdate = useCallback((scale: number) => {
        hud.updateZoom(scale);
    }, [hud]);

    // Tap
    const handleSingleTap = useCallback(() => {
        if (ui.state.locked) {
            ui.showLockIconTemporarily();
        } else {
            // toggleControls now automatically schedules auto-hide when showing
            ui.toggleControls();
        }
    }, [ui]);

    const handleDoubleTapSeek = useCallback((newTime: number, side: 'left' | 'right', x: number, y: number) => {
        // For double tap, set start time to CURRENT time (before seek) for proper diff display
        // Use forceNewStart=false so rapid taps accumulate (+10 -> +20 -> +30, etc.)
        hud.setSeekStartTime(player.currentTimeRef.current, false);

        // Update the shared value used by VideoHUD for instant feedback
        seekTimeShared.value = newTime;
        player.seekImmediate(newTime);

        // Show seek HUD with direction and side for opposite-side positioning
        const direction = side === 'left' ? 'backward' : 'forward';
        hud.showSeekHUD(newTime, direction, side, false); // false = not gesture active, will auto-hide

        // Trigger ripple effect at tap location
        hud.showRipple(x, y, side);
    }, [player, hud, seekTimeShared]);

    // ========================================================================
    // CREATE INDIVIDUAL GESTURES
    // ========================================================================

    const seekGesture = useSeekGesture({
        currentTimeShared: player.currentTimeShared,
        durationShared: player.durationShared,
        isLockedShared: ui.isLockedShared,
        seekStartTime,
        seekOffset,
        gestureActive,
        seekTimeShared,
        onSeekStart: handleSeekStart,
        onSeekUpdate: handleSeekUpdate, // This is now throttled
        onSeekComplete: handleSeekComplete,
        onLockTap: handleLockTap,
    });

    const brightnessGesture = useBrightnessGesture({
        screenWidth: width,
        leftZoneWidth,
        isLockedShared: ui.isLockedShared,
        currentBrightness,
        brightnessStart,
        onBrightnessChange: handleBrightnessChange,
        onBrightnessApply: setBrightnessNative,
        onGestureStart: ui.hideControls,
        onGestureEnd: handleBrightnessEnd,
        onLockTap: handleLockTap,
    });

    const volumeGesture = useVolumeGesture({
        screenWidth: width,
        rightZoneWidth,
        isLockedShared: ui.isLockedShared,
        currentVolume: audioController.currentVolumeShared,
        volumeStart,
        maxVolume: audioController.maxVolume, // Already normalized 1.0 or 2.0
        onVolumeChange: handleVolumeChange,
        onVolumeApply: audioController.applyVolume,
        onGestureStart: ui.hideControls,
        onGestureEnd: handleVolumeEnd,
        onLockTap: handleLockTap,
    });

    const { rightGesture: speedRightGesture, leftGesture: speedLeftGesture } = useSpeedGesture({
        screenWidth: width,
        isLockedShared: ui.isLockedShared,
        speedBase,
        speedGestureActive,
        lastSpeedUpdate,
        onSpeedChange: handleSpeedChange,
        onSpeedReset: handleSpeedReset,
        onGestureStart: ui.hideControls,
        onLockTap: handleLockTap,
    });

    const { pinchGesture, panGesture: zoomPanGesture } = useZoomGesture({
        screenWidth: width,
        screenHeight: height,
        isLockedShared: ui.isLockedShared,
        pinchScale,
        pinchScaleStart,
        panX,
        panY,
        panStartX,
        panStartY,
        zoomActive,
        onZoomStart: handleZoomStart,
        onZoomUpdate: handleZoomUpdate,
        onZoomReset: resetZoom,
        onLockTap: handleLockTap,
    });

    const tapGestures = useTapGestures({
        screenWidth: width,
        currentTimeShared: player.currentTimeShared,
        durationShared: player.durationShared,
        isLockedShared: ui.isLockedShared,
        onSingleTap: handleSingleTap,
        onDoubleTapSeek: handleDoubleTapSeek,
        onLockTap: handleLockTap,
    });

    // ========================================================================
    // COMPOSE ALL GESTURES
    // ========================================================================

    const composedGesture = useMemo(() => {
        // Speed gestures (left and right)
        const speedGestures = Gesture.Race(speedRightGesture, speedLeftGesture);

        // Vertical pan gestures (brightness left, volume right)
        const verticalGestures = Gesture.Exclusive(brightnessGesture, volumeGesture);

        // All pan gestures (horizontal seek, vertical brightness/volume)
        // Note: zoomPanGesture is REMOVED from here to be simultaneous with Pinch
        const panGestures = Gesture.Exclusive(seekGesture, verticalGestures);

        // Simultaneous Zoom + Pan (2 fingers)
        const zoomMultiGesture = Gesture.Simultaneous(pinchGesture, zoomPanGesture);

        // Final composition:
        // 1. Zoom/Pan (2 fingers) - wins if 2 fingers detected
        // 2. Speed gestures (long press) 
        // 3. Tap gestures
        // 4. Pan gestures (fallback - 1 finger)
        return Gesture.Race(zoomMultiGesture, speedGestures, tapGestures, panGestures);
    }, [
        pinchGesture,
        speedRightGesture,
        speedLeftGesture,
        tapGestures,
        seekGesture,
        brightnessGesture,
        volumeGesture,
        zoomPanGesture,
    ]);

    // ========================================================================
    // ANIMATED STYLE FOR VIDEO ZOOM/PAN
    // ========================================================================

    const videoAnimatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                { scale: pinchScale.value },
                { translateX: panX.value },
                { translateY: panY.value },
            ],
        };
    }, []);

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        composedGesture,
        videoAnimatedStyle,
        sharedValues: {
            zoomActive,
            pinchScale,
            currentBrightness,
            currentVolume,
            seekTime: seekTimeShared,
        },
        maxVolume: audioController.maxVolume,
        resetZoom,
    }), [
        composedGesture, videoAnimatedStyle,
        zoomActive, pinchScale, currentBrightness, currentVolume, seekTimeShared,
        audioController.maxVolume, resetZoom
    ]);
}

export default usePlayerGestures;
