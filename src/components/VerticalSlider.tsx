/**
 * VerticalSlider Component
 *
 * A custom vertical slider built with Reanimated and Gesture Handler.
 * Features:
 * - Smooth gesture handling
 * - Custom horizontal thumb
 * - Floating value indicator
 * - One tick when the thumb reaches either end
 */

import React, { useEffect, useCallback } from 'react';
import { View, StyleSheet, TextInput, AccessibilityActionEvent } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    useAnimatedProps,
    withSpring,
    withTiming,
    runOnJS,
    interpolate,
    Extrapolation,
    useDerivedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { haptic } from '@/native/HapticModule';
import { metrics, motion, playerTheme, type } from '@/theme/theme';

const { colors } = playerTheme;

const tickEdge = () => haptic('segmentTick');

interface VerticalSliderProps {
    min: number;
    max: number;
    value: number;
    onValueChange: (value: number) => void;
    step?: number;
    height?: number;
    width?: number;
    thumbColor?: string;
    trackColor?: string;
    activeTrackColor?: string;
    disabled?: boolean;
    accessibilityLabel?: string;
}

const THUMB_HEIGHT = 12;
const THUMB_WIDTH = 24;
const TRACK_WIDTH = 4;
const DEFAULT_HEIGHT = 180;

// Reanimated text for floating value
// Note: Reanimated Text support is limited, so we use a simple text update or TextInput approach
// For simplicity in this stack, we'll just show the rounded value in a dynamic view
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export const VerticalSlider: React.FC<VerticalSliderProps> = React.memo(({
    min,
    max,
    value,
    onValueChange,
    step = 1,
    height = DEFAULT_HEIGHT,
    thumbColor = colors.primary,
    trackColor = colors.fillStrong,
    activeTrackColor = colors.primary,
    disabled = false,
    accessibilityLabel,
}) => {
    // Shared values
    const progress = useSharedValue(0); // 0 to 1 (0 = min, 1 = max)
    const isTouching = useSharedValue(false);
    const lastStep = useSharedValue(value);
    const containerHeight = height;

    // Derived value for text on the UI thread
    const derivedSteppedValue = useDerivedValue(() => {
        const totalRange = max - min;
        const currentVal = min + (progress.value * totalRange);
        return Math.round(currentVal / step) * step;
    });

    // Initialize progress from value prop
    useEffect(() => {
        const clampedValue = Math.min(Math.max(value, min), max);
        const newProgress = (clampedValue - min) / (max - min);
        // Use withTiming only when prop changes from outside to avoid fighting gestures
        if (!isTouching.value) {
            progress.value = withSpring(newProgress, motion.spatial);
        }
    }, [value, min, max, isTouching, progress]);

    // One tick each time the thumb arrives at an end.
    const tickOnStepChange = () => {
        'worklet';
        const stepped = derivedSteppedValue.value;
        if (stepped !== lastStep.value) {
            lastStep.value = stepped;
            if (stepped <= min || stepped >= max) { runOnJS(tickEdge)(); }
        }
    };

    const onAccessibilityAction = useCallback((e: AccessibilityActionEvent) => {
        const { actionName } = e.nativeEvent;
        const delta = actionName === 'increment' ? step : actionName === 'decrement' ? -step : 0;
        const next = Math.min(Math.max(value + delta, min), max);
        if (next !== value) {onValueChange(next);}
    }, [value, step, min, max, onValueChange]);

    // Animated props for the value display
    const animatedProps = useAnimatedProps(() => {
        const val = derivedSteppedValue.value;
        const sign = val > 0 ? '+' : '';
        return {
            text: `${sign}${val} dB`,
        } as any;
    });

    // Gesture Handler
    const pan = Gesture.Pan()
        .enabled(!disabled)
        .activeOffsetY([-5, 5])
        .failOffsetX([-20, 20])
        .onBegin((e) => {
            'worklet';
            isTouching.value = true;
            lastStep.value = derivedSteppedValue.value;
            const relativeY = Math.max(0, Math.min(e.y, containerHeight));
            progress.value = 1 - (relativeY / containerHeight);
        })
        .onUpdate((e) => {
            'worklet';
            const relativeY = Math.max(0, Math.min(e.y, containerHeight));
            progress.value = 1 - (relativeY / containerHeight);
            tickOnStepChange();
        })
        .onEnd(() => {
            'worklet';
            isTouching.value = false;

            // Snap to exact step
            const totalRange = max - min;
            const finalValue = derivedSteppedValue.value;
            const finalProgress = (finalValue - min) / totalRange;

            progress.value = withSpring(finalProgress, motion.spatial);

            runOnJS(onValueChange)(finalValue);
        });

    // Animated Styles
    const thumbStyle = useAnimatedStyle(() => {
        const translateY = interpolate(
            progress.value,
            [0, 1],
            [containerHeight - THUMB_HEIGHT / 2, -THUMB_HEIGHT / 2],
            Extrapolation.CLAMP
        );

        return {
            transform: [
                { translateY },
                { scale: withSpring(isTouching.value ? 1.15 : 1, motion.press) },
            ],
            backgroundColor: thumbColor,
        };
    });

    const lowerTrackStyle = useAnimatedStyle(() => {
        return {
            height: progress.value * containerHeight,
            backgroundColor: activeTrackColor,
        };
    });

    const labelStyle = useAnimatedStyle(() => {
        const translateY = interpolate(
            progress.value,
            [0, 1],
            [containerHeight - 35, -35],
            Extrapolation.CLAMP
        );

        return {
            transform: [
                { translateX: -30 },
                { translateY },
            ],
            opacity: withTiming(isTouching.value ? 1 : 0, { duration: isTouching.value ? motion.fadeIn : motion.fadeOut }),
        };
    });

    return (
        <View
            style={[styles.container, { height }, disabled && styles.disabled]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled }}
            accessibilityValue={{ min, max, now: value, text: `${value > 0 ? '+' : ''}${value} dB` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={disabled ? undefined : onAccessibilityAction}
        >
            <GestureDetector gesture={pan}>
                <Animated.View style={[styles.touchArea, { height }]}>
                    {/* Background Track */}
                    <View style={[styles.track, { backgroundColor: trackColor, height }]}>
                        {/* Center Line Marker (0dB) */}
                        <View style={[styles.zeroMarker, { top: height / 2 }]} />

                        {/* Active/Filled Track (from bottom up) */}
                        <Animated.View style={[styles.activeTrack, lowerTrackStyle]} />
                    </View>

                    {/* Pop-up Value Indicator */}
                    <Animated.View style={[styles.valueIndicator, labelStyle]} pointerEvents="none">
                        <AnimatedTextInput
                            editable={false}
                            underlineColorAndroid="transparent"
                            style={styles.valueText}
                            animatedProps={animatedProps}
                        />
                    </Animated.View>

                    {/* Thumb */}
                    <Animated.View style={[styles.thumb, thumbStyle]} />
                </Animated.View>
            </GestureDetector>
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        width: 60, // Wider container for better touch area
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 0,
    },
    disabled: {
        opacity: 0.5,
    },
    touchArea: {
        width: 60,
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    track: {
        width: TRACK_WIDTH,
        borderRadius: TRACK_WIDTH / 2,
        overflow: 'hidden',
        position: 'absolute',
        left: (60 - TRACK_WIDTH) / 2,
    },
    activeTrack: {
        width: '100%',
        position: 'absolute',
        bottom: 0,
    },
    zeroMarker: {
        position: 'absolute',
        width: '100%',
        height: 1,
        backgroundColor: colors.fillStrong,
        zIndex: 1,
    },
    thumb: {
        position: 'absolute',
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT,
        borderRadius: metrics.radius.xs,
        top: 0,
        left: (60 - THUMB_WIDTH) / 2,
    },
    valueIndicator: {
        position: 'absolute',
        top: 0,
        backgroundColor: colors.cardElevated,
        paddingHorizontal: metrics.space.sm,
        paddingVertical: metrics.space.xs,
        borderRadius: metrics.radius.sm,
        zIndex: 100,
        left: '50%',
        minWidth: 60,
        alignItems: 'center',
    },
    valueText: {
        ...type.caption,
        color: colors.text,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
        padding: 0,
        margin: 0,
        textAlign: 'center',
    },
});
