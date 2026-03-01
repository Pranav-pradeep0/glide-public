// components/BookmarkToast.tsx
import React, { useEffect, memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withSequence,
    withDelay,
    runOnJS,
    cancelAnimation,
} from 'react-native-reanimated';
import { Feather } from '@react-native-vector-icons/feather';
import { HapticsIcon, BackgroundPlayIcon } from './VideoPlayer/PlayerIcons';

interface BookmarkToastProps {
    visible: boolean;
    message: string;
    duration?: number;
    onHide: () => void;
    icon?: string;
}

export const BookmarkToast = memo<BookmarkToastProps>(({ visible, message, duration = 2000, onHide, icon = 'bookmark' }) => {
    const translateY = useSharedValue(-100);
    const opacity = useSharedValue(0);

    useEffect(() => {
        if (visible) {
            // Show animation
            translateY.value = withSpring(0, {
                damping: 20,
                stiffness: 300,
            });
            opacity.value = withSpring(1);

            // Auto-hide after duration
            translateY.value = withSequence(
                withSpring(0, { damping: 20, stiffness: 300 }),
                withDelay(
                    duration,
                    withSpring(-100, {
                        damping: 20,
                        stiffness: 300,
                    }, (finished) => {
                        if (finished) {
                            runOnJS(onHide)();
                        }
                    })
                )
            );
            opacity.value = withSequence(
                withSpring(1),
                withDelay(duration, withSpring(0))
            );
        }

        return () => {
            cancelAnimation(translateY);
            cancelAnimation(opacity);
        };
    }, [visible, translateY, opacity, onHide, duration]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
        opacity: opacity.value,
    }));

    if (!visible && translateY.value === -100) {return null;}

    return (
        <Animated.View style={[styles.container, animatedStyle]} pointerEvents="none">
            {icon === 'haptics' ? (
                <HapticsIcon size={18} color="#fff" active={true} />
            ) : icon === 'background-play' ? (
                <BackgroundPlayIcon size={18} color="#fff" />
            ) : (
                <Feather name={icon as any} size={18} color="#fff" />
            )}
            <Text style={styles.message}>{message}</Text>
        </Animated.View>
    );
}, (prevProps, nextProps) => {
    return prevProps.visible === nextProps.visible && prevProps.message === nextProps.message;
});

BookmarkToast.displayName = 'BookmarkToast';

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 60,
        alignSelf: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        borderRadius: 16,
        paddingVertical: 8,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        zIndex: 1000,
    },
    message: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
});
