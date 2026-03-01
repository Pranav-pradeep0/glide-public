/**
 * useTapGestures Hook
 *
 * Implements tap gestures for video player:
 * - Single tap: Toggle controls visibility
 * - Double tap left: Seek backward 10 seconds
 * - Double tap right: Seek forward 10 seconds
 */

import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { SharedValue, runOnJS } from 'react-native-reanimated';
import { PLAYER_CONSTANTS } from './types';

// ============================================================================
// TYPES
// ============================================================================

interface UseTapGesturesOptions {
    // Screen dimensions
    screenWidth: number;

    // Shared values
    currentTimeShared: SharedValue<number>;
    durationShared: SharedValue<number>;
    isLockedShared: SharedValue<boolean>;

    // Callbacks
    onSingleTap: () => void;
    onDoubleTapSeek: (newTime: number, side: 'left' | 'right', x: number, y: number) => void;
    onLockTap: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Creates tap gestures for the video player.
 *
 * Returns composed gesture that handles:
 * - Single tap: Toggle controls
 * - Double tap left half: Seek -10s
 * - Double tap right half: Seek +10s
 *
 * Double taps take priority over single taps.
 */
export function useTapGestures(options: UseTapGesturesOptions) {
    const {
        screenWidth,
        currentTimeShared,
        durationShared,
        isLockedShared,
        onSingleTap,
        onDoubleTapSeek,
        onLockTap,
    } = options;

    const composedGesture = useMemo(() => {
        // Double tap on left side - seek backward
        const doubleTapLeft = Gesture.Tap()
            .numberOfTaps(2)
            .maxDuration(300)
            .hitSlop({
                left: 0,
                right: -(screenWidth / 2),
                top: 0,
                bottom: 0,
            })
            .onEnd((event) => {
                'worklet';

                if (isLockedShared.value) {
                    runOnJS(onLockTap)();
                    return;
                }

                const newTime = Math.max(
                    0,
                    currentTimeShared.value - PLAYER_CONSTANTS.DOUBLE_TAP_SEEK_SECONDS
                );

                // Update shared value immediately for instant HUD feedback
                currentTimeShared.value = newTime;

                runOnJS(onDoubleTapSeek)(newTime, 'left', event.absoluteX, event.absoluteY);
            });

        // Double tap on right side - seek forward
        const doubleTapRight = Gesture.Tap()
            .numberOfTaps(2)
            .maxDuration(300)
            .hitSlop({
                left: -(screenWidth / 2),
                right: 0,
                top: 0,
                bottom: 0,
            })
            .onEnd((event) => {
                'worklet';

                if (isLockedShared.value) {
                    runOnJS(onLockTap)();
                    return;
                }

                const newTime = Math.min(
                    durationShared.value || 0,
                    currentTimeShared.value + PLAYER_CONSTANTS.DOUBLE_TAP_SEEK_SECONDS
                );

                // Update shared value immediately for instant HUD feedback
                currentTimeShared.value = newTime;

                runOnJS(onDoubleTapSeek)(newTime, 'right', event.absoluteX, event.absoluteY);
            });

        // Single tap anywhere - toggle controls
        const singleTap = Gesture.Tap()
            .numberOfTaps(1)
            .maxDuration(300)
            .onEnd(() => {
                'worklet';

                if (isLockedShared.value) {
                    runOnJS(onLockTap)();
                    return;
                }

                runOnJS(onSingleTap)();
            });

        // Combine double taps (run simultaneously to detect either side)
        const doubleTaps = Gesture.Simultaneous(doubleTapLeft, doubleTapRight);

        // Double taps take priority over single tap
        return Gesture.Exclusive(doubleTaps, singleTap);
    }, [
        screenWidth,
        currentTimeShared,
        durationShared,
        isLockedShared,
        onSingleTap,
        onDoubleTapSeek,
        onLockTap,
    ]);

    return composedGesture;
}

export default useTapGestures;
