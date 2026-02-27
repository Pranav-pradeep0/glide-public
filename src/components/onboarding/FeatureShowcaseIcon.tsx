import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import StormSceneIcon from './StormSceneIcon';

interface FeatureShowcaseIconProps {
    animate: boolean;
    color: string;
    secondaryColor: string;
    onFeatureActivate?: (index: number) => void;
}

export default function FeatureShowcaseIcon({
    animate,
    color,
    secondaryColor,
    onFeatureActivate,
}: FeatureShowcaseIconProps) {
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const animateRef = useRef(animate);
    const onFeatureActivateRef = useRef(onFeatureActivate);
    const [vividOn, setVividOn] = useState(false);
    const [syncOn, setSyncOn] = useState(false);
    const [hapticsOn, setHapticsOn] = useState(false);

    useEffect(() => { onFeatureActivateRef.current = onFeatureActivate; }, [onFeatureActivate]);

    const clearTimers = useCallback(() => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
    }, []);

    const runShowcaseCycle = useCallback(() => {
        clearTimers();
        setVividOn(false);
        setSyncOn(false);
        setHapticsOn(false);

        const schedule = (fn: () => void, ms: number) => {
            const id = setTimeout(fn, ms);
            timersRef.current.push(id);
        };

        // Feature 0: Visual enhancement
        schedule(() => {
            setVividOn(true);
            onFeatureActivateRef.current?.(0);
        }, 860);

        // Feature 1: AI subtitle sync
        schedule(() => {
            setSyncOn(true);
            onFeatureActivateRef.current?.(1);
        }, 2440);

        // Feature 2: Haptic playback
        schedule(() => {
            setHapticsOn(true);
            onFeatureActivateRef.current?.(2);
        }, 4020);
    }, [clearTimers]);

    useEffect(() => {
        animateRef.current = animate;
    }, [animate]);

    useEffect(() => {
        if (!animate) {
            clearTimers();
            setVividOn(false);
            setSyncOn(false);
            setHapticsOn(false);
            onFeatureActivateRef.current?.(-1);
            return;
        }
        runShowcaseCycle();
        return () => {
            clearTimers();
        };
    }, [animate, clearTimers, runShowcaseCycle]);

    return (
        <View style={styles.container}>
            <StormSceneIcon
                animate={animate}
                vivid={vividOn}
                color={color}
                secondaryColor={secondaryColor}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
    },
});
