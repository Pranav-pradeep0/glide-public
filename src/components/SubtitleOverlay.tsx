import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    runOnJS,
} from 'react-native-reanimated';
import type { SubtitleCue } from '@/types';
import { FormattedSubtitleText } from '@/utils/SubtitleHtmlParser';


export interface SubtitleSettings {
    fontSize: number;
    fontColor: string;
    backgroundColor: string;
    backgroundOpacity: number;
    outlineColor: string;
    outlineWidth: number;
    position: 'top' | 'bottom' | 'middle';
    fontFamily?: string;
    fontWeight?: '400' | '600' | '700' | 'bold' | 'normal';
}


interface SubtitleOverlayProps {
    currentCue: SubtitleCue | null;
    settings: SubtitleSettings;
    onPositionChange?: (yOffset: number) => void;
    onFontSizeChange?: (fontSize: number) => void;
}


export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = React.memo(({
    currentCue,
    settings,
    onPositionChange,
    onFontSizeChange,
}) => {
    const { height } = useWindowDimensions();

    // Shared values for dragging
    const translateY = useSharedValue(0);
    const contextY = useSharedValue(0);
    const isDragging = useSharedValue(false);

    // Shared values for pinch-to-zoom font size
    const fontSize = useSharedValue(settings.fontSize);
    const savedFontSize = useSharedValue(settings.fontSize);
    const isPinching = useSharedValue(false);

    // Shared values for text container dimensions
    const textWidth = useSharedValue(0);
    const textHeight = useSharedValue(0);

    // Font size constraints
    const MIN_FONT_SIZE = 12;
    const MAX_FONT_SIZE = 48;

    // Padding around text in gesture indicator
    const INDICATOR_PADDING = 20;

    // Smooth spring config for better feel
    const SMOOTH_SPRING_CONFIG = {
        damping: 20,
        stiffness: 120,
        mass: 0.5,
        overshootClamping: false,
    };

    const ACTIVE_SPRING_CONFIG = {
        damping: 50,
        stiffness: 400,
        mass: 0.3,
    };

    // Calculate initial offset based on settings position
    const getInitialOffset = useCallback(() => {
        switch (settings.position) {
            case 'top':
                return -height * 0.4; // Push closer to top
            case 'middle':
                return 0;
            case 'bottom':
            default:
                return height * 0.4; // Push closer to bottom
        }
    }, [settings.position, height]);

    // Initialize position based on settings
    useEffect(() => {
        translateY.value = getInitialOffset();
    }, [settings.position, height]);

    // Sync fontSize shared value when settings change
    useEffect(() => {
        fontSize.value = settings.fontSize;
        savedFontSize.value = settings.fontSize;
    }, [settings.fontSize]);

    // Handle text container layout changes
    const handleTextLayout = useCallback((event: any) => {
        const { width, height: layoutHeight } = event.nativeEvent.layout;
        textWidth.value = width;
        textHeight.value = layoutHeight;
    }, []);

    // Pan gesture for vertical dragging
    const panGesture = Gesture.Pan()
        .activeOffsetY([-10, 10])
        .failOffsetX([-15, 15])
        .onStart(() => {
            'worklet';
            isDragging.value = true;
            contextY.value = translateY.value;
        })
        .onUpdate((event) => {
            'worklet';
            // Constraints relative to center
            const limitY = height * 0.45; // Allow dragging close to edges
            const minY = -limitY;
            const maxY = limitY;

            const newY = contextY.value + event.translationY;
            translateY.value = Math.max(minY, Math.min(maxY, newY));
        })
        .onEnd(() => {
            'worklet';
            isDragging.value = false;

            if (onPositionChange) {
                runOnJS(onPositionChange)(translateY.value);
            }
        });

    // Pinch gesture for font size adjustment
    const pinchGesture = Gesture.Pinch()
        .onStart(() => {
            'worklet';
            isPinching.value = true;
            savedFontSize.value = fontSize.value;
        })
        .onUpdate((event) => {
            'worklet';
            const newFontSize = savedFontSize.value * event.scale;
            fontSize.value = Math.max(
                MIN_FONT_SIZE,
                Math.min(MAX_FONT_SIZE, newFontSize)
            );
        })
        .onEnd(() => {
            'worklet';
            isPinching.value = false;

            if (onFontSizeChange) {
                runOnJS(onFontSizeChange)(fontSize.value);
            }
        });

    // Compose gestures to work simultaneously
    const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

    // Animated style for container position and subtle feedback
    const animatedContainerStyle = useAnimatedStyle(() => {
        const isActive = isDragging.value || isPinching.value;

        return {
            transform: [
                {
                    translateY: withSpring(
                        translateY.value,
                        isActive ? ACTIVE_SPRING_CONFIG : SMOOTH_SPRING_CONFIG
                    ),
                },
                {
                    scale: withSpring(
                        isActive ? 1.02 : 1,
                        SMOOTH_SPRING_CONFIG
                    ),
                },
            ],
        };
    });

    // Animated background that tightly wraps text with subtle padding
    const animatedBackgroundStyle = useAnimatedStyle(() => {
        const isActive = isDragging.value || isPinching.value;

        // Calculate scale factor based on font size change
        const fontSizeRatio = fontSize.value / settings.fontSize;

        // Use actual text dimensions with subtle padding
        // Scale proportionally with font size changes
        const scaledWidth = textWidth.value > 0
            ? textWidth.value * fontSizeRatio + INDICATOR_PADDING
            : 0;

        const scaledHeight = textHeight.value > 0
            ? textHeight.value * fontSizeRatio + INDICATOR_PADDING
            : 0;

        return {
            width: withSpring(
                isActive ? scaledWidth : 0,
                SMOOTH_SPRING_CONFIG
            ),
            height: withSpring(
                isActive ? scaledHeight : 0,
                SMOOTH_SPRING_CONFIG
            ),
            backgroundColor: withSpring(
                isActive ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0)',
                SMOOTH_SPRING_CONFIG
            ),
            borderColor: withSpring(
                isActive ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0)',
                SMOOTH_SPRING_CONFIG
            ),
            borderWidth: withSpring(
                isActive ? 1 : 0,
                SMOOTH_SPRING_CONFIG
            ),
        };
    });

    // Animated font size
    const animatedTextStyle = useAnimatedStyle(() => {
        const isActive = isPinching.value;

        return {
            fontSize: withSpring(
                fontSize.value,
                isActive ? ACTIVE_SPRING_CONFIG : SMOOTH_SPRING_CONFIG
            ),
        };
    });

    const textShadowStyle = settings.outlineWidth > 0
        ? {
            textShadowColor: settings.outlineColor,
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: settings.outlineWidth,
            elevation: 2,
        }
        : {};

    const hasSubtitle = currentCue && currentCue.text.trim();

    return (
        <GestureDetector gesture={composedGesture}>
            <Animated.View
                style={[
                    styles.container,
                    animatedContainerStyle,
                ]}
                pointerEvents="box-none"
            >
                {/* Dynamic background indicator - tight fit */}
                <Animated.View
                    style={[
                        styles.gestureIndicator,
                        animatedBackgroundStyle,
                    ]}
                />

                {/* Subtitle content */}
                {hasSubtitle && (
                    <Animated.View
                        style={[
                            styles.textContainer,
                            {
                                backgroundColor:
                                    settings.backgroundColor === 'transparent'
                                        ? 'transparent'
                                        : `${settings.backgroundColor}${Math.round(
                                            settings.backgroundOpacity * 255
                                        )
                                            .toString(16)
                                            .padStart(2, '0')}`,
                            },
                        ]}
                        onLayout={handleTextLayout}
                    >
                        <FormattedSubtitleText
                            text={currentCue.text}
                            baseStyle={{
                                color: settings.fontColor,
                                fontWeight: settings.fontWeight || '600',
                                fontFamily: settings.fontFamily,
                                textAlign: 'center',
                                includeFontPadding: false, // Android specific fix for vertical alignment
                                ...textShadowStyle,
                            }}
                            animatedStyle={animatedTextStyle}
                            maxLines={2}
                        />
                    </Animated.View>
                )}
            </Animated.View>
        </GestureDetector>
    );
});


const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        zIndex: 6,
    },
    gestureIndicator: {
        position: 'absolute',
        borderRadius: 12,
        alignSelf: 'center',
    },
    textContainer: {
        paddingHorizontal: 8,
        paddingVertical: 2, // Minimized vertical padding as requested
        borderRadius: 4,
        maxWidth: '90%',
        zIndex: 1,
    },
});
