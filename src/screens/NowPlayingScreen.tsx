import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Feather from '@react-native-vector-icons/feather';
import Slider from '@react-native-community/slider';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useAudioStore } from '@/store/audioStore';
import { useFavoritesStore } from '@/store/favoritesStore';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumPalette } from '@/hooks/useAlbumArt';
import { LyricsService } from '@/services/LyricsService';
import { Button, Chip, IconButton, ListGroup, ListRow, Sheet, Touchable } from '@/components/ui';
import { metrics, motion, type } from '@/theme/theme';
import { formatDuration } from '@/utils/formatUtils';
import { EQUALIZER_PRESETS } from '@/config/equalizerPresets';
import { AudioTrack, LyricLine } from '@/types';
import { haptic } from '@/native/HapticModule';

interface QueueItem {
    track: AudioTrack;
    index: number;
}

export default function NowPlayingScreen() {
    const { colors, dark } = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();

    const currentTrack = useAudioStore((s) => s.currentTrack);
    const queue = useAudioStore((s) => s.queue);
    const currentIndex = useAudioStore((s) => s.currentIndex);
    const isPlaying = useAudioStore((s) => s.isPlaying);
    const isBuffering = useAudioStore((s) => s.isBuffering);
    const position = useAudioStore((s) => s.position);
    const duration = useAudioStore((s) => s.duration);
    const shuffle = useAudioStore((s) => s.shuffle);
    const repeatMode = useAudioStore((s) => s.repeatMode);
    const equalizerPreset = useAudioStore((s) => s.equalizerPreset);
    const shuffledIndices = useAudioStore((s) => s.shuffledIndices);
    const queueSource = useAudioStore((s) => s.queueSource);
    const sleepTimerMode = useAudioStore((s) => s.sleepTimerMode);
    const sleepTimerRemaining = useAudioStore((s) => s.sleepTimerRemaining);

    const togglePlayPause = useAudioStore((s) => s.togglePlayPause);
    const skipNext = useAudioStore((s) => s.skipNext);
    const skipPrevious = useAudioStore((s) => s.skipPrevious);
    const skipToIndex = useAudioStore((s) => s.skipToIndex);
    const toggleShuffle = useAudioStore((s) => s.toggleShuffle);
    const toggleRepeatMode = useAudioStore((s) => s.toggleRepeatMode);
    const seekTo = useAudioStore((s) => s.seekTo);
    const setEqualizerPreset = useAudioStore((s) => s.setEqualizerPreset);
    const removeFromQueue = useAudioStore((s) => s.removeFromQueue);
    const moveQueueItem = useAudioStore((s) => s.moveQueueItem);
    const setSleepTimer = useAudioStore((s) => s.setSleepTimer);

    // Favorites
    const isFavorite = useFavoritesStore((s) => (currentTrack ? s.isFavorite(currentTrack.id) : false));
    const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

    // Lazily resolve artwork and dynamic palette colors
    const { artworkUri: fetchedArt, primaryColor, secondaryColor, onPrimaryColor } = useAlbumPalette(
        currentTrack?.albumId,
        currentTrack?.uri
    );
    const artworkUri = currentTrack?.artworkUri || fetchedArt;
    const accentColor = primaryColor || colors.primary;

    // Local seek slider state
    const [isSeeking, setIsSeeking] = useState(false);
    const [seekValue, setSeekValue] = useState(0);

    // View toggles and sheets
    const [showQueue, setShowQueue] = useState(false);
    const [showEqualizer, setShowEqualizer] = useState(false);
    const [showSleepTimer, setShowSleepTimer] = useState(false);
    const [showLyrics, setShowLyrics] = useState(false);

    // Lyrics state
    const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
    const lyricsListRef = useRef<FlatList<LyricLine>>(null);

    // Load lyrics when currentTrack changes
    useEffect(() => {
        if (!currentTrack) {
            setLyrics(null);
            return;
        }
        let isMounted = true;
        LyricsService.getLyricsForTrack(currentTrack.id, currentTrack.path).then((data) => {
            if (isMounted) {
                setLyrics(data);
            }
        });
        return () => {
            isMounted = false;
        };
    }, [currentTrack?.id, currentTrack?.path]);

    const handlePickLyrics = useCallback(async () => {
        if (!currentTrack) return;
        const loaded = await LyricsService.pickAndSaveLyrics(currentTrack.id);
        if (loaded) {
            setLyrics(loaded);
        }
    }, [currentTrack]);

    const handleSlidingStart = useCallback((val: number) => {
        setIsSeeking(true);
        setSeekValue(val);
    }, []);

    const handleSlidingComplete = useCallback(
        (val: number) => {
            setIsSeeking(false);
            seekTo(val);
        },
        [seekTo]
    );

    const handleSelectPreset = useCallback(
        (presetId: string) => {
            setEqualizerPreset(presetId);
        },
        [setEqualizerPreset]
    );

    const handleToggleFavorite = useCallback(() => {
        if (!currentTrack) return;
        haptic('tick');
        toggleFavorite(currentTrack.id);
    }, [currentTrack, toggleFavorite]);

    const handleDismiss = useCallback(() => {
        navigation.goBack();
    }, [navigation]);

    const handleSkipNext = useCallback(() => {
        haptic('tick');
        skipNext();
    }, [skipNext]);

    const handleSkipPrevious = useCallback(() => {
        haptic('tick');
        skipPrevious();
    }, [skipPrevious]);

    // Cover horizontal swipe gesture with spring feedback
    const coverTranslateX = useSharedValue(0);
    const coverAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: coverTranslateX.value }],
    }));

    const coverPanGesture = Gesture.Pan()
        .activeOffsetX([-20, 20])
        .onUpdate((e) => {
            'worklet';
            coverTranslateX.value = e.translationX * 0.35;
        })
        .onEnd((e) => {
            'worklet';
            if (e.translationX < -50 || e.velocityX < -400) {
                runOnJS(handleSkipNext)();
            } else if (e.translationX > 50 || e.velocityX > 400) {
                runOnJS(handleSkipPrevious)();
            }
            coverTranslateX.value = withSpring(0, motion.spatial);
        });

    // Screen-level swipe down to dismiss (downward only, gives up on horizontal movement)
    const dismissPanGesture = Gesture.Pan()
        .activeOffsetY(20)
        .failOffsetX([-20, 20])
        .onEnd((e) => {
            'worklet';
            if (e.translationY > 80 && (e.velocityY > 300 || e.translationY > 140)) {
                runOnJS(handleDismiss)();
            }
        });

    // Responsive artwork sizing
    const artSize = useMemo(() => {
        const availableWidth = windowWidth - metrics.gutter * 2;
        const maxArtHeight = windowHeight * 0.38;
        return Math.min(availableWidth, maxArtHeight, 330);
    }, [windowWidth, windowHeight]);

    const currentPosition = isSeeking ? seekValue : position;
    const effectiveDuration = duration > 0 ? duration : currentTrack?.duration ?? 0;

    // Ordered queue items (reflects shuffle sequence if active)
    const displayQueue: QueueItem[] = useMemo(() => {
        if (shuffle && shuffledIndices.length === queue.length) {
            return shuffledIndices.map((idx) => ({ track: queue[idx], index: idx }));
        }
        return queue.map((track, index) => ({ track, index }));
    }, [queue, shuffle, shuffledIndices]);

    // Compute initial scroll index for the current playing song
    const currentQueueDisplayIndex = useMemo(() => {
        const idx = displayQueue.findIndex((item) => item.index === currentIndex);
        return idx >= 0 ? idx : 0;
    }, [displayQueue, currentIndex]);

    // Active lyric line index
    const activeLyricIndex = useMemo(() => {
        if (!lyrics || lyrics.length === 0) return -1;
        let active = -1;
        for (let i = 0; i < lyrics.length; i++) {
            if (lyrics[i].time <= currentPosition) {
                active = i;
            } else {
                break;
            }
        }
        return active;
    }, [lyrics, currentPosition]);

    // Auto-scroll lyrics cleanly centered without height drift
    useEffect(() => {
        if (showLyrics && activeLyricIndex >= 0 && lyricsListRef.current) {
            lyricsListRef.current.scrollToIndex({
                index: activeLyricIndex,
                viewPosition: 0.5,
                animated: true,
            });
        }
    }, [activeLyricIndex, showLyrics]);

    if (!currentTrack) {
        return (
            <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
                <View style={styles.header}>
                    <IconButton
                        icon="chevron-down"
                        onPress={() => navigation.goBack()}
                        accessibilityLabel="Close player"
                    />
                </View>
                <View style={styles.emptyContainer}>
                    <Feather name="music" size={48} color={colors.textTertiary} />
                    <Text style={[type.row, { color: colors.textSecondary }]}>No track loaded</Text>
                </View>
            </View>
        );
    }

    return (
        <GestureDetector gesture={dismissPanGesture}>
            <View style={[styles.container, { backgroundColor: colors.background }]}>
                {/* Dynamic Gradient backdrop tinted by cover's primary color */}
                <LinearGradient
                    colors={
                        primaryColor
                            ? [
                                  primaryColor,
                                  secondaryColor || `${primaryColor}66`,
                                  dark ? '#121214' : colors.background,
                              ]
                            : [dark ? '#1c1c1f' : '#e6e6ea', colors.background]
                    }
                    style={StyleSheet.absoluteFill}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 0.9 }}
                />
                <View
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            backgroundColor: dark ? 'rgba(0,0,0,0.48)' : 'rgba(255,255,255,0.45)',
                        },
                    ]}
                    pointerEvents="none"
                />

                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + metrics.space.xs }]}>
                    <IconButton
                        icon="chevron-down"
                        onPress={handleDismiss}
                        accessibilityLabel="Collapse player"
                        iconSize={26}
                    />
                    <View style={styles.headerTitleWrap}>
                        <Text
                            style={[
                                type.caption,
                                { color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 1.2 },
                            ]}
                            numberOfLines={1}
                        >
                            {queueSource ? `Playing from ${queueSource}` : 'Playing from Library'}
                        </Text>
                        <Text style={[type.row, { color: colors.text }]} numberOfLines={1}>
                            {currentTrack.album || currentTrack.artist || 'Glide Audio'}
                        </Text>
                    </View>
                    <View style={styles.headerActions}>
                        <IconButton
                            icon="moon"
                            onPress={() => setShowSleepTimer(true)}
                            active={sleepTimerMode !== 'off'}
                            accessibilityLabel="Sleep timer"
                            iconSize={20}
                        />
                        <IconButton
                            icon="sliders"
                            onPress={() => setShowEqualizer(true)}
                            accessibilityLabel="Equalizer"
                            iconSize={20}
                        />
                    </View>
                </View>

                {/* Main Content Body */}
                <View style={styles.body}>
                    {/* Artwork / Lyrics Interactive Area */}
                    <View style={styles.artArea}>
                        {showLyrics ? (
                            <View style={[styles.lyricsBox, { height: artSize, backgroundColor: colors.fill }]}>
                                {lyrics && lyrics.length > 0 ? (
                                    <FlatList
                                        ref={lyricsListRef}
                                        data={lyrics}
                                        keyExtractor={(line, idx) => `${line.time}-${idx}`}
                                        showsVerticalScrollIndicator={false}
                                        contentContainerStyle={styles.lyricsContent}
                                        onScrollToIndexFailed={(info) => {
                                            lyricsListRef.current?.scrollToOffset({
                                                offset: Math.max(0, info.averageItemLength * info.index - artSize / 2),
                                                animated: true,
                                            });
                                        }}
                                        renderItem={({ item: line, index: idx }) => {
                                            const isActive = idx === activeLyricIndex;
                                            return (
                                                <Touchable
                                                    onPress={() => seekTo(line.time)}
                                                    style={styles.lyricRow}
                                                    scaleTo={0.98}
                                                >
                                                    <Text
                                                        style={[
                                                            type.body,
                                                            styles.lyricText,
                                                            isActive
                                                                ? { color: accentColor, fontWeight: '700', fontSize: 18 }
                                                                : { color: colors.textSecondary },
                                                        ]}
                                                    >
                                                        {line.text}
                                                    </Text>
                                                </Touchable>
                                            );
                                        }}
                                    />
                                ) : (
                                    <View style={styles.emptyLyricsWrap}>
                                        <Feather name="file-text" size={32} color={colors.textTertiary} />
                                        <Text style={[type.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
                                            No lyrics found (.lrc file)
                                        </Text>
                                        <Button
                                            label="Load lyrics…"
                                            icon="upload"
                                            variant="secondary"
                                            size="md"
                                            onPress={handlePickLyrics}
                                        />
                                    </View>
                                )}
                            </View>
                        ) : (
                            <GestureDetector gesture={coverPanGesture}>
                                <Animated.View
                                    style={[
                                        styles.artFrame,
                                        coverAnimatedStyle,
                                        {
                                            width: artSize,
                                            height: artSize,
                                            backgroundColor: colors.surfaceVariant,
                                            shadowColor: colors.shadow,
                                        },
                                    ]}
                                >
                                    {artworkUri ? (
                                        <Image
                                            source={{ uri: artworkUri }}
                                            style={StyleSheet.absoluteFill}
                                            resizeMode="cover"
                                        />
                                    ) : (
                                        <View style={styles.artPlaceholder}>
                                            <Feather name="music" size={artSize * 0.3} color={colors.textTertiary} />
                                        </View>
                                    )}
                                </Animated.View>
                            </GestureDetector>
                        )}
                    </View>

                    {/* Track Info (Title on 2 lines with Favorite action) */}
                    <View style={styles.infoArea}>
                        <View style={styles.titleRow}>
                            <View style={styles.titleTextWrap}>
                                <Text
                                    style={[type.heading, { color: colors.text, textAlign: 'center' }]}
                                    numberOfLines={2}
                                >
                                    {currentTrack.title}
                                </Text>
                                <Text
                                    style={[type.body, { color: colors.textSecondary, textAlign: 'center' }]}
                                    numberOfLines={1}
                                >
                                    {currentTrack.artist}
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Scrubber / Slider Tinted with cover's accent */}
                    <View style={styles.scrubberArea}>
                        <Slider
                            style={styles.slider}
                            value={currentPosition}
                            minimumValue={0}
                            maximumValue={effectiveDuration > 0 ? effectiveDuration : 1}
                            onSlidingStart={handleSlidingStart}
                            onValueChange={(val) => setSeekValue(val)}
                            onSlidingComplete={handleSlidingComplete}
                            minimumTrackTintColor={accentColor}
                            maximumTrackTintColor={colors.fillStrong}
                            thumbTintColor={accentColor}
                        />
                        <View style={styles.timeRow}>
                            <Text style={[type.caption, styles.timeText, { color: colors.textSecondary }]}>
                                {formatDuration(currentPosition)}
                            </Text>
                            <Text style={[type.caption, styles.timeText, { color: colors.textSecondary }]}>
                                {formatDuration(effectiveDuration)}
                            </Text>
                        </View>
                    </View>

                    {/* Controls Row */}
                    <View style={styles.controlsArea}>
                        {/* Shuffle button */}
                        <IconButton
                            icon="shuffle"
                            onPress={toggleShuffle}
                            active={shuffle}
                            accessibilityLabel="Shuffle"
                            iconSize={20}
                        />

                        {/* Previous */}
                        <IconButton
                            icon="skip-back"
                            onPress={handleSkipPrevious}
                            accessibilityLabel="Previous track"
                            iconSize={26}
                        />

                        {/* Play/Pause FAB with real spinner when buffering */}
                        <Touchable
                            onPress={togglePlayPause}
                            style={[styles.playFab, { backgroundColor: accentColor }]}
                            accessibilityRole="button"
                            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                            scaleTo={0.94}
                        >
                            {isBuffering ? (
                                <ActivityIndicator size="small" color={onPrimaryColor || colors.onPrimary} />
                            ) : (
                                <Feather
                                    name={isPlaying ? 'pause' : 'play'}
                                    size={28}
                                    color={onPrimaryColor || colors.onPrimary}
                                    style={!isPlaying ? { marginLeft: 3 } : undefined}
                                />
                            )}
                        </Touchable>

                        {/* Next */}
                        <IconButton
                            icon="skip-forward"
                            onPress={handleSkipNext}
                            accessibilityLabel="Next track"
                            iconSize={26}
                        />

                        {/* Repeat button */}
                        <View>
                            <IconButton
                                icon="repeat"
                                onPress={toggleRepeatMode}
                                active={repeatMode !== 'off'}
                                accessibilityLabel={`Repeat mode: ${repeatMode}`}
                                iconSize={20}
                            />
                            {repeatMode === 'one' && (
                                <View style={[styles.repeatBadge, { backgroundColor: accentColor }]}>
                                    <Text style={[styles.repeatBadgeText, { color: onPrimaryColor || colors.onPrimary }]}>1</Text>
                                </View>
                            )}
                        </View>
                    </View>

                    {/* Bottom Row: Actions & Queue Trigger */}
                    <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, metrics.space.sm) }]}>
                        <IconButton
                            icon="heart"
                            onPress={handleToggleFavorite}
                            active={isFavorite}
                            color={isFavorite ? colors.primary : colors.textSecondary}
                            accessibilityLabel="Toggle favorite"
                            iconSize={20}
                        />

                        <Touchable
                            onPress={() => setShowQueue(true)}
                            style={[styles.queueButton, { backgroundColor: colors.fill }]}
                            accessibilityLabel="View queue"
                            scaleTo={0.98}
                        >
                            <Feather name="list" size={18} color={colors.textSecondary} />
                            <Text style={[type.label, { color: colors.textSecondary }]}>
                                Queue ({queue.length})
                            </Text>
                        </Touchable>

                        <IconButton
                            icon="file-text"
                            onPress={() => setShowLyrics(!showLyrics)}
                            active={showLyrics}
                            accessibilityLabel="Toggle lyrics"
                            iconSize={20}
                        />
                    </View>
                </View>

                {/* Queue Bottom Sheet (Opens at current song, supports remove and reorder) */}
                <Sheet
                    visible={showQueue}
                    onClose={() => setShowQueue(false)}
                    title={`Queue (${queue.length})`}
                >
                    <View style={styles.sheetListWrap}>
                        <FlatList
                            data={displayQueue}
                            keyExtractor={(item) => `${item.track.id}-${item.index}`}
                            initialScrollIndex={currentQueueDisplayIndex}
                            getItemLayout={(_, index) => ({
                                length: 58,
                                offset: 58 * index,
                                index,
                            })}
                            onScrollToIndexFailed={() => {
                                // Gracefully ignore layout calculation failure
                            }}
                            renderItem={({ item, index: displayIndex }) => {
                                const isCurrent = item.index === currentIndex;
                                return (
                                    <View style={[styles.queueRowWrap, isCurrent && { backgroundColor: colors.primaryContainer }]}>
                                        <Touchable
                                            style={styles.queueRowTouchable}
                                            onPress={() => {
                                                skipToIndex(item.index);
                                                setShowQueue(false);
                                            }}
                                            scaleTo={0.98}
                                        >
                                            <Feather
                                                name={isCurrent ? 'volume-2' : 'music'}
                                                size={18}
                                                color={isCurrent ? accentColor : colors.textTertiary}
                                            />
                                            <View style={styles.queueItemInfo}>
                                                <Text
                                                    style={[
                                                        type.row,
                                                        { color: isCurrent ? accentColor : colors.text, fontWeight: isCurrent ? '700' : '400' },
                                                    ]}
                                                    numberOfLines={1}
                                                >
                                                    {item.track.title}
                                                </Text>
                                                <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                                                    {item.track.artist} · {formatDuration(item.track.duration)}
                                                </Text>
                                            </View>
                                        </Touchable>

                                        {/* Queue item actions: reorder & remove */}
                                        <View style={styles.queueItemActions}>
                                            {!shuffle && displayIndex > 0 && (
                                                <IconButton
                                                    icon="chevron-up"
                                                    onPress={() => moveQueueItem(item.index, item.index - 1)}
                                                    accessibilityLabel="Move up"
                                                    iconSize={16}
                                                    style={styles.smallQueueBtn}
                                                />
                                            )}
                                            {!shuffle && displayIndex < displayQueue.length - 1 && (
                                                <IconButton
                                                    icon="chevron-down"
                                                    onPress={() => moveQueueItem(item.index, item.index + 1)}
                                                    accessibilityLabel="Move down"
                                                    iconSize={16}
                                                    style={styles.smallQueueBtn}
                                                />
                                            )}
                                            <IconButton
                                                icon="x"
                                                onPress={() => removeFromQueue(item.index)}
                                                accessibilityLabel="Remove from queue"
                                                iconSize={16}
                                                style={styles.smallQueueBtn}
                                            />
                                        </View>
                                    </View>
                                );
                            }}
                            initialNumToRender={15}
                            maxToRenderPerBatch={10}
                            windowSize={5}
                            showsVerticalScrollIndicator={false}
                        />
                    </View>
                </Sheet>

                {/* Sleep Timer Bottom Sheet */}
                <Sheet
                    visible={showSleepTimer}
                    onClose={() => setShowSleepTimer(false)}
                    title="Sleep Timer"
                >
                    <ListGroup inset style={styles.sleepTimerGroup}>
                        <ListRow
                            title="Off"
                            selected={sleepTimerMode === 'off'}
                            onPress={() => {
                                setSleepTimer('off');
                                setShowSleepTimer(false);
                            }}
                        />
                        <ListRow
                            title="15 minutes"
                            selected={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 15}
                            value={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 15 ? `${Math.ceil(sleepTimerRemaining / 60)}m left` : undefined}
                            onPress={() => {
                                setSleepTimer(15);
                                setShowSleepTimer(false);
                            }}
                        />
                        <ListRow
                            title="30 minutes"
                            selected={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 30}
                            value={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 30 ? `${Math.ceil(sleepTimerRemaining / 60)}m left` : undefined}
                            onPress={() => {
                                setSleepTimer(30);
                                setShowSleepTimer(false);
                            }}
                        />
                        <ListRow
                            title="45 minutes"
                            selected={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 45}
                            value={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 45 ? `${Math.ceil(sleepTimerRemaining / 60)}m left` : undefined}
                            onPress={() => {
                                setSleepTimer(45);
                                setShowSleepTimer(false);
                            }}
                        />
                        <ListRow
                            title="60 minutes"
                            selected={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 60}
                            value={sleepTimerMode === 'time' && Math.round(sleepTimerRemaining / 60) === 60 ? `${Math.ceil(sleepTimerRemaining / 60)}m left` : undefined}
                            onPress={() => {
                                setSleepTimer(60);
                                setShowSleepTimer(false);
                            }}
                        />
                        <ListRow
                            title="At the end of this song"
                            selected={sleepTimerMode === 'end_of_track'}
                            onPress={() => {
                                setSleepTimer('end_of_track');
                                setShowSleepTimer(false);
                            }}
                        />
                    </ListGroup>
                </Sheet>

                {/* Equalizer Bottom Sheet */}
                <Sheet visible={showEqualizer} onClose={() => setShowEqualizer(false)} title="Equalizer Presets">
                    <View style={styles.presetsWrap}>
                        {EQUALIZER_PRESETS.map((p) => {
                            const selected = equalizerPreset === p.id;
                            return (
                                <Chip
                                    key={p.id}
                                    label={p.name}
                                    selected={selected}
                                    onPress={() => handleSelectPreset(p.id)}
                                />
                            );
                        })}
                    </View>
                </Sheet>
            </View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: metrics.gutter,
        minHeight: 56,
    },
    headerTitleWrap: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: metrics.space.sm,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: metrics.space.md,
    },
    body: {
        flex: 1,
        justifyContent: 'space-between',
        paddingHorizontal: metrics.gutter,
    },
    artArea: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: metrics.space.sm,
    },
    artFrame: {
        borderRadius: metrics.radius.card,
        overflow: 'hidden',
        elevation: 8,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 14,
    },
    artPlaceholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    lyricsBox: {
        width: '100%',
        borderRadius: metrics.radius.card,
        overflow: 'hidden',
        padding: metrics.space.md,
    },
    lyricsContent: {
        paddingVertical: metrics.space.lg,
    },
    lyricRow: {
        paddingVertical: metrics.space.sm,
        paddingHorizontal: metrics.space.sm,
        borderRadius: metrics.radius.sm,
    },
    lyricText: {
        textAlign: 'center',
        lineHeight: 26,
    },
    emptyLyricsWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: metrics.space.md,
        paddingHorizontal: metrics.space.lg,
    },
    infoArea: {
        paddingVertical: metrics.space.xs,
    },
    titleRow: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleTextWrap: {
        width: '100%',
        alignItems: 'center',
        gap: 4,
    },
    scrubberArea: {
        paddingVertical: metrics.space.xs,
    },
    slider: {
        width: '100%',
        height: 40,
    },
    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: metrics.space.xs,
        marginTop: -6,
    },
    timeText: {
        fontVariant: ['tabular-nums'],
    },
    controlsArea: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: metrics.space.sm,
        paddingHorizontal: metrics.space.xs,
    },
    playFab: {
        width: 68,
        height: 68,
        borderRadius: 34,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 4,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
    },
    repeatBadge: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 14,
        height: 14,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
    },
    repeatBadgeText: {
        fontSize: 9,
        fontWeight: '700',
    },
    bottomBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: metrics.space.xs,
    },
    queueButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: metrics.space.lg,
        paddingVertical: metrics.space.sm,
        borderRadius: metrics.radius.pill,
        gap: metrics.space.xs,
    },
    sheetListWrap: {
        maxHeight: 420,
    },
    queueRowWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: metrics.gutter,
        height: 58,
        borderRadius: metrics.radius.md,
    },
    queueRowTouchable: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
    },
    queueItemInfo: {
        flex: 1,
        gap: 2,
    },
    queueItemActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    smallQueueBtn: {
        width: 32,
        height: 32,
    },
    sleepTimerGroup: {
        paddingHorizontal: metrics.gutter,
        paddingVertical: metrics.space.sm,
    },
    presetsWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: metrics.space.sm,
        paddingHorizontal: metrics.gutter,
        paddingVertical: metrics.space.md,
    },
});
