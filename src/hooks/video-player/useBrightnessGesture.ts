/**
 * useBrightnessGesture Hook
 *
 * Implements vertical pan gesture on the LEFT side of screen to adjust brightness.
 * Swipe up increases, swipe down decreases.
 */

import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { SharedValue, runOnJS, useSharedValue } from 'react-native-reanimated';
import { PLAYER_CONSTANTS } from './types';

// ============================================================================
// TYPES
// ============================================================================

interface UseBrightnessGestureOptions {
    // Screen dimensions for hit slop calculation
    screenWidth: number;
    leftZoneWidth: number;

    // Shared values
    isLockedShared: SharedValue<boolean>;
    currentBrightness: SharedValue<number>;
    brightnessStart: SharedValue<number>;

    // Callbacks
    onBrightnessChange: (value: number) => void;
    onBrightnessApply: (value: number, isFinal?: boolean) => void;
    onBrightnessWait?: () => void;
    onGestureStart: () => void;
    onGestureEnd: () => void;
    onLockTap: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Creates a vertical pan gesture for brightness control.
 * Active only on the left ~15% of the screen.
 */
export function useBrightnessGesture(options: UseBrightnessGestureOptions) {
    const {
        screenWidth,
        leftZoneWidth,
        isLockedShared,
        currentBrightness,
        brightnessStart,
        onBrightnessChange,
        onBrightnessApply,
        onGestureEnd,
        onGestureStart,
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
            // Only active on left side of screen
            .hitSlop({
                left: 0,
                right: -(screenWidth - leftZoneWidth),
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

                // Capture starting brightness
                brightnessStart.value = currentBrightness.value;

                // Show HUD immediately (still need to notify JS to show the component)
                runOnJS(onBrightnessChange)(currentBrightness.value);

                // Hide controls
                runOnJS(onGestureStart)();
            })
            .onUpdate((event) => {
                'worklet';

                if (isLockedShared.value) {return;}

                // Calculate delta - negative Y translation = up = increase
                const delta = -event.translationY * PLAYER_CONSTANTS.BRIGHTNESS_SENSITIVITY;
                const newValue = Math.max(0, Math.min(1, brightnessStart.value + delta));

                // Update shared value (HUD will read this directly)
                currentBrightness.value = newValue;

                // Update system brightness - throttle to avoid bridge congestion
                // Update every 3rd pixel roughly (sensitivity 0.008 -> 125px full range)
                // Just use frame throttle
                if (Math.floor(Math.abs(event.translationY)) % 5 === 0) {
                    runOnJS(onBrightnessApply)(newValue);
                }
            })
            .onEnd(() => {
                'worklet';
                runOnJS(onBrightnessApply)(currentBrightness.value, true);
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
        // No onEnd needed -> onEnd added now for persistence
    }, [
        screenWidth,
        leftZoneWidth,
        isLockedShared,
        currentBrightness,
        brightnessStart,
        onBrightnessChange,
        onBrightnessApply,
        onGestureEnd,
        onLockTap,
    ]);

    return gesture;
}

export default useBrightnessGesture;
