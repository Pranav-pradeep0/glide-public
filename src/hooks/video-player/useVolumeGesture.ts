/**
 * useVolumeGesture Hook
 *
 * Implements vertical pan gesture on the RIGHT side of screen to adjust volume.
 * Swipe up increases, swipe down decreases.
 */

import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { SharedValue, runOnJS, useSharedValue } from 'react-native-reanimated';
import { PLAYER_CONSTANTS } from './types';

// ============================================================================
// TYPES
// ============================================================================

interface UseVolumeGestureOptions {
    // Screen dimensions for hit slop calculation
    screenWidth: number;
    rightZoneWidth: number;

    // Shared values
    isLockedShared: SharedValue<boolean>;
    currentVolume: SharedValue<number>;
    volumeStart: SharedValue<number>;

    // Limits
    maxVolume: number; // 1.0 or 2.0

    // Callbacks
    onVolumeChange: (value: number) => void;
    onVolumeApply: (value: number, fromGesture?: boolean) => void;
    onGestureStart: () => void;
    onGestureEnd: () => void;
    onLockTap: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Creates a vertical pan gesture for volume control.
 * Active only on the right ~15% of the screen.
 */
export function useVolumeGesture(options: UseVolumeGestureOptions) {
    const {
        screenWidth,
        rightZoneWidth,
        isLockedShared,
        currentVolume,
        volumeStart,
        maxVolume,
        onVolumeChange,
        onVolumeApply,
        onGestureStart,
        onGestureEnd,
        onLockTap,
    } = options;

    const isGestureActive = useSharedValue(false);

    const gesture = useMemo(() => {
        return Gesture.Pan()
            // Only allow 1 finger
            .maxPointers(1)
            // Only activate on clear vertical movement (strict to avoid Double Tap conflict)
            .activeOffsetY([-25, 25])
            // Fail if horizontal swipe
            .failOffsetX([-15, 15])
            // Only active on right side of screen
            .hitSlop({
                left: -(screenWidth - rightZoneWidth),
                right: 0,
                top: 0,
                bottom: 0,
            })
            .onStart(() => {
                'worklet';

                if (isLockedShared.value) {
                    runOnJS(onLockTap)();
                    return;
                }

                isGestureActive.value = true;

                // Capture starting volume
                volumeStart.value = currentVolume.value;

                // Show HUD immediately (for visibility)
                runOnJS(onVolumeChange)(currentVolume.value);

                // Hide controls
                runOnJS(onGestureStart)();
            })
            .onUpdate((event) => {
                'worklet';

                if (isLockedShared.value) {return;}

                // Calculate delta - negative Y translation = up = increase
                const delta = -event.translationY * PLAYER_CONSTANTS.VOLUME_SENSITIVITY;
                const newValue = Math.max(0, Math.min(maxVolume, volumeStart.value + delta));

                // Update shared value (HUD reads this directly)
                currentVolume.value = newValue;

                // Throttle system volume updates (pixel-based, matching brightness)
                if (Math.floor(Math.abs(event.translationY)) % 5 === 0) {
                    runOnJS(onVolumeApply)(newValue, true);
                }
            })
            .onFinalize(() => {
                'worklet';
                if (isGestureActive.value) {
                    if (!isLockedShared.value) {
                        runOnJS(onGestureEnd)();
                    }
                    isGestureActive.value = false;
                }
            });
        // No onEnd needed - volume value persists
    }, [
        screenWidth,
        rightZoneWidth,
        isLockedShared,
        currentVolume,
        volumeStart,
        maxVolume,
        onVolumeChange,
        onVolumeApply,
        onGestureEnd,
        onLockTap,
    ]);

    return gesture;
}

export default useVolumeGesture;
