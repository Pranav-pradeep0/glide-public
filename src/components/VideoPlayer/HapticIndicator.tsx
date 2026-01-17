import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withDelay,
    withSequence,
    withRepeat,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { Feather, FeatherIconName } from "@react-native-vector-icons/feather"
import { useTheme } from '../../hooks/useTheme';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { HapticPattern } from '../../types/hapticTypes';

interface HapticIndicatorProps {
    pattern: HapticPattern | null;
}

export default function HapticIndicator({
    pattern,
}: HapticIndicatorProps) {
    const colors = useTheme().colors;
    const scale = useSharedValue(0);
    const opacity = useSharedValue(0);
    const rotation = useSharedValue(0);

    useEffect(() => {
        if (pattern) {
            // Reset
            scale.value = 0;
            opacity.value = 0;
            rotation.value = 0;

            // Animate in
            opacity.value = withSpring(1);

            // Animation based on category
            switch (pattern.category) {
                case 'oscillating':
                    // Pulse breathing effect
                    scale.value = withRepeat(
                        withSequence(
                            withTiming(1.2, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
                            withTiming(1.0, { duration: 1000, easing: Easing.inOut(Easing.ease) })
                        ),
                        -1,
                        true
                    );
                    break;
                case 'textured':
                    // Shake effect
                    scale.value = withSpring(1.2);
                    rotation.value = withRepeat(
                        withSequence(
                            withTiming(10, { duration: 50 }),
                            withTiming(-10, { duration: 50 })
                        ),
                        -1,
                        true
                    );
                    break;
                case 'impact':
                    // Sharp pop
                    scale.value = withSequence(
                        withSpring(1.5, { damping: 5 }),
                        withSpring(1)
                    );
                    break;
                case 'rhythmic':
                    // Beat
                    scale.value = withRepeat(
                        withSequence(
                            withTiming(1.2, { duration: 100 }),
                            withTiming(1, { duration: 400 })
                        ),
                        -1,
                        false
                    );
                    break;
            }

            // Auto hide if duration is short, otherwise parent handles nulling pattern
            if (pattern.duration < 500) {
                opacity.value = withDelay(pattern.duration, withSpring(0));
            }

        } else {
            scale.value = withSpring(0);
            opacity.value = withSpring(0);
            rotation.value = withSpring(0);
        }
    }, [pattern]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: scale.value },
            { rotate: `${rotation.value}deg` }
        ],
        opacity: opacity.value,
    }));

    const getCategoryColor = () => {
        if (!pattern) return colors.primary;
        switch (pattern.category) {
            case 'oscillating': return '#4FC3F7'; // Light Blue
            case 'textured': return '#FFB74D'; // Orange
            case 'impact': return '#E57373'; // Red
            case 'rhythmic': return '#81C784'; // Green
            default: return colors.primary;
        }
    };

    const getCategoryIcon = () => {
        if (!pattern) return 'zap';
        switch (pattern.category) {
            case 'oscillating': return 'wind';
            case 'textured': return 'radio';
            case 'impact': return 'zap';
            case 'rhythmic': return 'music';
            default: return 'zap';
        }
    };

    if (!pattern) return null;

    return (
        <Animated.View style={[styles.container, animatedStyle]}>
            <View
                style={[
                    styles.indicator,
                    { backgroundColor: getCategoryColor() },
                ]}
            >
                <Feather
                    name={getCategoryIcon()}
                    size={32}
                    color={colors.text}
                />
                <Text style={styles.text}>{pattern.soundEffect}</Text>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: '20%', // Moved up slightly to not block center view
        right: '10%', // Moved to right side
        alignItems: 'center',
        justifyContent: 'center',
    },
    indicator: {
        width: 100,
        height: 100,
        borderRadius: 50,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    text: {
        ...typography.caption,
        fontWeight: '700',
        marginTop: spacing.xs,
        textTransform: 'capitalize',
        textAlign: 'center',
        maxWidth: 80,
    },
});
