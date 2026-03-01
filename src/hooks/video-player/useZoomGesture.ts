/**
 * useZoomGesture Hook
 *
 * Implements pinch-to-zoom and pan gestures for video zoom.
 * Pinch zooms the video, pan moves it when zoomed.
 */

import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { SharedValue, runOnJS, useSharedValue } from 'react-native-reanimated';
import { PLAYER_CONSTANTS } from './types';

// ============================================================================
// TYPES
// ============================================================================

interface UseZoomGestureOptions {
    // Screen dimensions
    screenWidth: number;
    screenHeight: number;

    // Shared values
    isLockedShared: SharedValue<boolean>;
    pinchScale: SharedValue<number>;
    pinchScaleStart: SharedValue<number>;
    panX: SharedValue<number>;
    panY: SharedValue<number>;
    panStartX: SharedValue<number>;
    panStartY: SharedValue<number>;
    zoomActive: SharedValue<boolean>;

    // Callbacks
    onZoomStart: () => void;
    onZoomUpdate: (scale: number) => void;
    onZoomReset: () => void;
    onLockTap: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Creates pinch and pan gestures for video zoom control.
 *
 * Pinch: Zoom in/out (1x to 3x)
 * Pan (when zoomed): Move the video around
 */
export function useZoomGesture(options: UseZoomGestureOptions) {
    const {
        screenWidth,
        screenHeight,
        isLockedShared,
        pinchScale,
        pinchScaleStart,
        panX,
        panY,
        panStartX,
        panStartY,
        zoomActive,
        onZoomStart,
        onZoomUpdate,
        onZoomReset,
        onLockTap,
    } = options;

    const pinchActive = useSharedValue(false);
    const lastReportedScale = useSharedValue(0); // For throttling

    // Pinch gesture for zooming
    const pinchGesture = useMemo(() => {
        return Gesture.Pinch()
            .onStart(() => {
                'worklet';

                if (isLockedShared.value) {
                    runOnJS(onLockTap)();
                    return;
                }

                pinchActive.value = true;
                zoomActive.value = true;
                pinchScaleStart.value = pinchScale.value;

                runOnJS(onZoomStart)();
            })
            .onUpdate((event) => {
                'worklet';

                if (isLockedShared.value || !pinchActive.value) {return;}

                const newScale = Math.max(
                    PLAYER_CONSTANTS.ZOOM_MIN,
                    Math.min(
                        PLAYER_CONSTANTS.ZOOM_MAX,
                        pinchScaleStart.value * event.scale
                    )
                );

                pinchScale.value = newScale;

                // Throttle JS updates to prevent "steppy" feel
                // Only notify JS if the scale has changed significantly since the last update (by 0.05)
                if (Math.abs(newScale - lastReportedScale.value) > 0.05) {
                    lastReportedScale.value = newScale;
                    runOnJS(onZoomUpdate)(newScale);
                }
            })
            .onEnd(() => {
                'worklet';

                if (!pinchActive.value) {return;}
                pinchActive.value = false;
                zoomActive.value = false;

                // Reset zoom if scale is too small
                if (pinchScale.value < 1.1) {
                    runOnJS(onZoomReset)();
                }
            })
            .onFinalize(() => {
                'worklet';

                if (!pinchActive.value) {return;}
                pinchActive.value = false;
                zoomActive.value = false;

                if (pinchScale.value < 1.1) {
                    runOnJS(onZoomReset)();
                }
            });
    }, [
        isLockedShared,
        pinchScale,
        pinchScaleStart,
        zoomActive,
        onZoomStart,
        onZoomUpdate,
        onZoomReset,
        onLockTap,
        pinchActive,
    ]);

    // Pan gesture for moving zoomed video
    const panGesture = useMemo(() => {
        return Gesture.Pan()
            // STRICTLY Require 2 fingers
            .minPointers(2)
            .maxPointers(2) // Explicitly limit to 2 fingers
            .minDistance(10)
            .onStart(() => {
                'worklet';

                if (isLockedShared.value) {return;}

                panStartX.value = panX.value;
                panStartY.value = panY.value;
            })
            .onUpdate((event) => {
                'worklet';

                // Only pan when zoomed and not locked
                if (isLockedShared.value) {return;}
                if (!zoomActive.value && pinchScale.value <= 1) {return;}

                // Calculate max pan based on zoom level
                const maxPan = ((pinchScale.value - 1) * Math.min(screenWidth, screenHeight)) / 2;

                panX.value = Math.max(
                    -maxPan,
                    Math.min(maxPan, panStartX.value + event.translationX)
                );
                panY.value = Math.max(
                    -maxPan,
                    Math.min(maxPan, panStartY.value + event.translationY)
                );
            });
    }, [
        screenWidth,
        screenHeight,
        pinchScale,
        panX,
        panY,
        panStartX,
        panStartY,
        zoomActive,
        isLockedShared, // Added explicit dependency
    ]);

    return { pinchGesture, panGesture };
}

export default useZoomGesture;
