import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from '@react-native-vector-icons/feather';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useAudioStore } from '@/store/audioStore';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumArt } from '@/hooks/useAlbumArt';
import { IconButton, Touchable } from '@/components/ui';
import { metrics, type } from '@/theme/theme';
import { RootStackParamList } from '@/types';
import { haptic } from '@/native/HapticModule';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function MiniPlayer() {
    const { colors } = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const currentTrack = useAudioStore((s) => s.currentTrack);
    const isPlaying = useAudioStore((s) => s.isPlaying);
    const isBuffering = useAudioStore((s) => s.isBuffering);
    const position = useAudioStore((s) => s.position);
    const duration = useAudioStore((s) => s.duration);
    const togglePlayPause = useAudioStore((s) => s.togglePlayPause);
    const skipNext = useAudioStore((s) => s.skipNext);
    const skipPrevious = useAudioStore((s) => s.skipPrevious);

    const fetchedArt = useAlbumArt(currentTrack?.albumId, currentTrack?.uri);
    const artworkUri = currentTrack?.artworkUri || fetchedArt;

    const handlePress = useCallback(() => {
        navigation.navigate('NowPlaying');
    }, [navigation]);

    const handleSkipNext = useCallback(() => {
        haptic('tick');
        skipNext();
    }, [skipNext]);

    const handleSkipPrev = useCallback(() => {
        haptic('tick');
        skipPrevious();
    }, [skipPrevious]);

    const panGesture = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetX([-20, 20])
                .activeOffsetY([-20, 20])
                .onEnd((e) => {
                    'worklet';
                    if (e.translationY < -35 && Math.abs(e.translationY) > Math.abs(e.translationX)) {
                        runOnJS(handlePress)();
                    } else if (e.translationX < -45) {
                        runOnJS(handleSkipNext)();
                    } else if (e.translationX > 45) {
                        runOnJS(handleSkipPrev)();
                    }
                }),
        [handlePress, handleSkipNext, handleSkipPrev]
    );

    if (!currentTrack) {
        return null;
    }

    const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

    return (
        <View style={[styles.wrapper, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            {/* Progress line at top */}
            <View style={[styles.progressTrack, { backgroundColor: colors.fillStrong }]}>
                <View
                    style={[
                        styles.progressBar,
                        {
                            width: `${progress * 100}%`,
                            backgroundColor: colors.primary,
                        },
                    ]}
                />
            </View>

            <GestureDetector gesture={panGesture}>
                <Touchable
                    onPress={handlePress}
                    scaleTo={0.99}
                    style={styles.content}
                    accessibilityRole="button"
                    accessibilityLabel={`Now playing: ${currentTrack.title} by ${currentTrack.artist}`}
                >
                    {/* Artwork */}
                    <View style={[styles.artContainer, { backgroundColor: colors.surfaceVariant }]}>
                        {artworkUri ? (
                            <Image source={{ uri: artworkUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        ) : (
                            <Feather name="music" size={18} color={colors.textTertiary} />
                        )}
                    </View>

                    {/* Track metadata */}
                    <View style={styles.textContainer}>
                        <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>
                            {currentTrack.title}
                        </Text>
                        <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                            {currentTrack.artist}
                        </Text>
                    </View>

                    {/* Controls */}
                    <View style={styles.actions} pointerEvents="box-none">
                        {isBuffering ? (
                            <View style={styles.spinnerSlot}>
                                <ActivityIndicator size="small" color={colors.primary} />
                            </View>
                        ) : (
                            <IconButton
                                icon={isPlaying ? 'pause' : 'play'}
                                onPress={togglePlayPause}
                                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                                iconSize={20}
                            />
                        )}
                        <IconButton
                            icon="skip-forward"
                            onPress={skipNext}
                            accessibilityLabel="Next track"
                            iconSize={20}
                        />
                    </View>
                </Touchable>
            </GestureDetector>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: '100%',
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    progressTrack: {
        height: 2,
        width: '100%',
    },
    progressBar: {
        height: '100%',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
        paddingHorizontal: metrics.gutter,
        gap: metrics.space.md,
    },
    artContainer: {
        width: 40,
        height: 40,
        borderRadius: metrics.radius.sm,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    textContainer: {
        flex: 1,
        justifyContent: 'center',
        gap: 2,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    spinnerSlot: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
