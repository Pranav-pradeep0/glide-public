import React, { FC, useEffect, useRef } from 'react';
import { View, Pressable, StyleSheet, Animated } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';

interface LockButtonProps {
    isLocked: boolean;
    showLockIcon: boolean;
    onToggleLock: () => void;
}

export const LockButton: FC<LockButtonProps> = ({ isLocked, showLockIcon, onToggleLock }) => {
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (showLockIcon) {
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }).start();
        }
    }, [showLockIcon, fadeAnim]);

    if (!showLockIcon) return null;

    return (
        <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
            <Pressable
                onPress={onToggleLock}
                style={styles.lockButton}
                hitSlop={20}
            >
                <View style={styles.iconContainer}>
                    <Feather
                        name={isLocked ? 'lock' : 'unlock'}
                        size={18}
                        color="#fff"
                    />
                </View>
            </Pressable>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 20,
        top: '50%',
        marginTop: -28,
        zIndex: 100,
    },
    lockButton: {
        padding: 8,
    },
    iconContainer: {
        // backgroundColor: 'rgba(0,0,0,0.5)',
        // borderRadius: 28,
        // width: 56,
        // height: 56,
        // justifyContent: 'center',
        // alignItems: 'center',
        // borderWidth: 2,
        // borderColor: 'rgba(255,255,255,0.3)',
    },
});
