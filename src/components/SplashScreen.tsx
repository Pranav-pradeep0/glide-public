import React, { useEffect } from 'react';
import { StyleSheet, View, Text, Platform } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withDelay,
    runOnJS,
    Easing,
} from 'react-native-reanimated';
import LinearGradient from 'react-native-linear-gradient';
import { Logo } from './Logo';
import { useTheme } from '@/hooks/useTheme';

interface SplashScreenProps {
    visible: boolean;
    onAnimationEnd: () => void;
}

const ANIMATION_DURATION = 500;

export function SplashScreen({
    visible,
    onAnimationEnd,
}: SplashScreenProps) {
    // Shared values for animations
    const containerOpacity = useSharedValue(1);
    const containerScale = useSharedValue(1);

    // Logo entrance animation - start fully visible to match native splash
    const logoOpacity = useSharedValue(1);
    const logoScale = useSharedValue(1);

    // No entrance animation - seamless transition from native splash
    useEffect(() => {
        // Entrance sequence removed
    }, []);

    useEffect(() => {
        // Exit sequence
        if (!visible) {
            // Animate logo out
            logoOpacity.value = withTiming(0, { duration: 300 });
            logoScale.value = withTiming(1.2, { duration: 300 });

            // Animate container out
            containerOpacity.value = withDelay(
                200,
                withTiming(0, {
                    duration: 400,
                    easing: Easing.inOut(Easing.ease),
                }, (finished) => {
                    if (finished) {
                        runOnJS(onAnimationEnd)();
                    }
                })
            );

            // Subtle zoom effect on exit
            containerScale.value = withDelay(
                200,
                withTiming(1.05, {
                    duration: 400,
                    easing: Easing.out(Easing.quad),
                })
            );
        }
    }, [visible, onAnimationEnd]);

    const containerStyle = useAnimatedStyle(() => ({
        opacity: containerOpacity.value,
        transform: [{ scale: containerScale.value }],
    }));

    const logoAnimatedStyle = useAnimatedStyle(() => ({
        opacity: logoOpacity.value,
        transform: [{ scale: logoScale.value }],
    }));

    if (!visible && containerOpacity.value === 0) {
        return null;
    }

    const theme = useTheme();

    return (
        <Animated.View style={[styles.container, containerStyle, { backgroundColor: theme.colors.background }]}>

            <View style={styles.content}>
                <Animated.View style={logoAnimatedStyle}>
                    <Logo width={280} height={280} mode={theme.dark ? 'dark' : 'light'} />
                </Animated.View>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 99999, // Ensure it's above everything
        elevation: 99999,
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    titleContainer: {
        marginBottom: 16,
    },
});

export default SplashScreen;
