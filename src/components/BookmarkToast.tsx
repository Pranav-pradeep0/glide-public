// components/BookmarkToast.tsx
import React, { useEffect, memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    withSequence,
    withDelay,
    runOnJS,
    cancelAnimation,
    Easing,
} from 'react-native-reanimated';

/** Enough movement to imply direction, not enough to pull the eye off the video. */
const SLIDE_DISTANCE = 8;
const ENTER_MS = 180;
const EXIT_MS = 200;

interface BookmarkToastProps {
    visible: boolean;
    message: string;
    duration?: number;
    onHide: () => void;
}

/**
 * A transient status line: "Haptics Enabled", "Background play on", and so on.
 *
 * Text only. It used to lead with an icon per message type, which meant a second thing to
 * parse in a notice that is on screen for two seconds, over moving picture. The words
 * already say what happened.
 */
export const BookmarkToast = memo<BookmarkToastProps>(({
    visible,
    message,
    duration = 2000,
    onHide,
}) => {
    // An acknowledgement, not an event: it should appear, be read, and leave without
    // asking for attention.
    //
    // This used to spring a 100px slide and spring the opacity too, which overshot in both
    // and read as a bounce. A spring is for something the user is dragging; a notice that
    // simply arrives wants a timing curve.
    const translateY = useSharedValue(-SLIDE_DISTANCE);
    const opacity = useSharedValue(0);

    useEffect(() => {
        if (!visible) { return; }

        // Each value is assigned exactly once. The previous version set translateY twice --
        // directly and again through withSequence -- so the two animations raced.
        translateY.value = withSequence(
            withTiming(0, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) }),
            withDelay(duration, withTiming(-SLIDE_DISTANCE, { duration: EXIT_MS }))
        );
        opacity.value = withSequence(
            withTiming(1, { duration: ENTER_MS }),
            withDelay(duration, withTiming(0, { duration: EXIT_MS }, (finished) => {
                if (finished) { runOnJS(onHide)(); }
            }))
        );

        return () => {
            cancelAnimation(translateY);
            cancelAnimation(opacity);
        };
    }, [visible, translateY, opacity, onHide, duration]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
        opacity: opacity.value,
    }));

    // Reading a shared value during render is not reliable, so `visible` is the only source
    // of truth. The hook that owns it also clears it on a timer, so unmounting mid-animation
    // (entering PiP, say) can no longer strand it open and replay it on the next mount.
    if (!visible) { return null; }

    return (
        <Animated.View style={[styles.container, animatedStyle]} pointerEvents="none">
            <Text style={styles.message}>{message}</Text>
        </Animated.View>
    );
}, (prevProps, nextProps) => {
    return prevProps.visible === nextProps.visible
        && prevProps.message === nextProps.message
        && prevProps.duration === nextProps.duration;
});

BookmarkToast.displayName = 'BookmarkToast';

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        // Clear of the HUD title row, which this used to land directly on top of. Bottom is
        // not an option: subtitles and the transport controls both live there, and covering
        // a subtitle mid-sentence is worse than covering nothing at all.
        top: 110,
        alignSelf: 'center',
        maxWidth: '80%',
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        borderRadius: 16,
        paddingVertical: 8,
        paddingHorizontal: 14,
        zIndex: 1000,
    },
    message: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
        textAlign: 'center',
    },
});
