// components/VideoPlayer/SidePanel.tsx
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sheet, SheetHeader } from '@/components/ui';
import { PLAYER_BACKDROP, playerColors } from '@/theme/colors';
import { metrics, motion } from '@/theme/theme';

interface SidePanelProps {
    visible: boolean;
    title: string;
    onClose: () => void;
    /** A page inside a flow: chevron back before the title. */
    onBack?: () => void;
    children: React.ReactNode;
}

/**
 * The container every player panel shares. Landscape: a card springing in from the right
 * edge over the video. Portrait: a bottom sheet. Children fill the body and own their scrolling.
 */
export function SidePanel(props: SidePanelProps) {
    const { width, height } = useWindowDimensions();
    return width > height ? <Panel {...props} /> : <PortraitSheet {...props} />;
}

function PortraitSheet({ visible, title, onClose, onBack, children }: SidePanelProps) {
    const { height } = useWindowDimensions();
    return (
        <Sheet visible={visible} onClose={onClose} title={title} onBack={onBack} onPlayer>
            <View style={{ height: height * 0.6 }}>{children}</View>
        </Sheet>
    );
}

/** Always mounted by its callers, so it can animate out. */
function Panel({ visible, title, onClose, onBack, children }: SidePanelProps) {
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const width = Math.min(360, windowWidth * 0.4) + insets.right;
    const progress = useSharedValue(0);
    const scrim = useSharedValue(0);

    useEffect(() => {
        progress.value = visible
            ? withSpring(1, motion.spatial)
            : withTiming(0, { duration: motion.fadeOut });
        scrim.value = withTiming(visible ? 1 : 0, { duration: visible ? motion.fadeIn : motion.fadeOut });
    }, [visible, progress, scrim]);

    const panelStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: (1 - progress.value) * width }],
    }));
    const backdropStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

    return (
        <>
            <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents={visible ? 'auto' : 'none'}>
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={`Close ${title.toLowerCase()}`}
                />
            </Animated.View>

            <Animated.View
                style={[styles.panel, panelStyle, { width, paddingTop: insets.top + metrics.space.md, paddingRight: insets.right }]}
                pointerEvents={visible ? 'auto' : 'none'}
                accessibilityViewIsModal={visible}
            >
                <View style={styles.header}>
                    <SheetHeader title={title} onBack={onBack} onClose={onClose} onPlayer />
                </View>
                <View style={[styles.body, { paddingBottom: insets.bottom }]}>{children}</View>
            </Animated.View>
        </>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        ...StyleSheet.absoluteFill,
        backgroundColor: PLAYER_BACKDROP,
        zIndex: 100,
    },
    panel: {
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: playerColors.card,
        borderTopLeftRadius: metrics.radius.lg,
        borderBottomLeftRadius: metrics.radius.lg,
        zIndex: 101,
    },
    header: { paddingHorizontal: metrics.gutter, paddingBottom: metrics.space.sm },
    body: { flex: 1, paddingHorizontal: metrics.gutter },
});
