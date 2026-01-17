/**
 * DoubleTapRipple Component - Minimalistic Design
 * 
 * A clean, subtle ripple effect with a single expanding ring.
 * Designed for elegance and performance.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    interpolate,
    Easing,
    runOnJS,
} from 'react-native-reanimated';
import { PLAYER_CONSTANTS } from '@/hooks/video-player/types';

interface DoubleTapRippleProps {
    show: boolean;
    x: number;
    y: number;
    side: 'left' | 'right';
    onAnimationComplete?: () => void;
}

const RIPPLE_SIZE = 80;
const RIPPLE_SCALE_TARGET = 2.5;
const RIPPLE_DURATION = 400;

export const DoubleTapRipple: React.FC<DoubleTapRippleProps> = React.memo(({
    show,
    x,
    y,
    side,
    onAnimationComplete,
}) => {
    const progress = useSharedValue(0);

    useEffect(() => {
        if (show) {
            // Reset and animate
            progress.value = 0;
            progress.value = withTiming(
                1,
                {
                    duration: RIPPLE_DURATION,
                    easing: Easing.out(Easing.quad),
                },
                (finished) => {
                    'worklet';
                    if (finished && onAnimationComplete) {
                        runOnJS(onAnimationComplete)();
                    }
                }
            );
        }
    }, [show, progress, onAnimationComplete]);

    const animatedStyle = useAnimatedStyle(() => {
        const scale = interpolate(
            progress.value,
            [0, 1],
            [0.3, RIPPLE_SCALE_TARGET]
        );

        const opacity = interpolate(
            progress.value,
            [0, 0.2, 1],
            [0.5, 0.3, 0]
        );

        return {
            transform: [
                { translateX: x - RIPPLE_SIZE / 2 },
                { translateY: y - RIPPLE_SIZE / 2 },
                { scale },
            ],
            opacity,
        };
    }, [x, y]);

    if (!show) return null;

    return (
        <View style={styles.container} pointerEvents="none">
            <Animated.View style={[styles.ripple, animatedStyle]} />
        </View>
    );
});

DoubleTapRipple.displayName = 'DoubleTapRipple';

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 10,
        overflow: 'hidden',
    },
    ripple: {
        position: 'absolute',
        width: RIPPLE_SIZE,
        height: RIPPLE_SIZE,
        borderRadius: RIPPLE_SIZE / 2,
        borderWidth: 4,
        borderColor: 'rgba(255, 255, 255, 0.3)',
        backgroundColor: 'transparent',
    },
});

export default DoubleTapRipple;
