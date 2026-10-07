import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { Button, Touchable } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { useAudioStore } from '@/store/audioStore';
import { isLyricsSynced } from '@/services/LyricsService';
import { LyricLine } from '@/types';
import { metrics, type } from '@/theme/theme';

interface NowPlayingLyricsProps {
    lyrics: LyricLine[] | null;
    artSize: number;
    accentColor: string;
    isLoading?: boolean;
    onPickLyrics: () => void;
}

/** Index of the line playing at `position`, or -1 if unsynced or before the first line. */
function activeLineIndex(lyrics: LyricLine[] | null, position: number, isSynced: boolean): number {
    if (!lyrics || !isSynced) { return -1; }
    let active = -1;
    for (let i = 0; i < lyrics.length; i++) {
        if (lyrics[i].time >= 0 && lyrics[i].time <= position) {
            active = i;
        }
    }
    return active;
}

/**
 * Isolated lyrics viewer for NowPlayingScreen.
 *
 * Subscribes to the *active line index*, not to `position`: the store's position changes
 * twice a second, the line every few seconds, and only a line change needs a render.
 */
export const NowPlayingLyrics: React.FC<NowPlayingLyricsProps> = React.memo(({
    lyrics,
    artSize,
    accentColor,
    isLoading,
    onPickLyrics,
}) => {
    const { colors } = useTheme();
    const isSynced = useMemo(() => isLyricsSynced(lyrics), [lyrics]);

    const activeLyricIndex = useAudioStore((s) => activeLineIndex(lyrics, s.position, isSynced));
    const seekTo = useAudioStore((s) => s.seekTo);
    const lyricsListRef = useRef<FlatList<LyricLine>>(null);

    const renderLine = useCallback(({ item: line, index: idx }: { item: LyricLine; index: number }) => {
        if (!isSynced) {
            return (
                <View style={styles.lyricRow}>
                    <Text
                        style={[
                            type.body,
                            styles.lyricText,
                            { color: colors.text },
                        ]}
                    >
                        {line.text}
                    </Text>
                </View>
            );
        }

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
    }, [isSynced, activeLyricIndex, accentColor, colors.text, colors.textSecondary, seekTo]);

    // Auto-scroll lyrics cleanly centered (synced lyrics only)
    useEffect(() => {
        if (isSynced && activeLyricIndex >= 0 && lyricsListRef.current) {
            lyricsListRef.current.scrollToIndex({
                index: activeLyricIndex,
                viewPosition: 0.5,
                animated: true,
            });
        }
    }, [activeLyricIndex, isSynced]);

    return (
        <View style={[styles.lyricsBox, { height: artSize, backgroundColor: colors.fill }]}>
            {isLoading ? (
                <View style={styles.emptyLyricsWrap}>
                    <ActivityIndicator size="small" color={accentColor} />
                    <Text style={[type.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
                        Looking for lyrics…
                    </Text>
                </View>
            ) : lyrics && lyrics.length > 0 ? (
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
                    renderItem={renderLine}
                    extraData={activeLyricIndex}
                />
            ) : (
                <View style={styles.emptyLyricsWrap}>
                    <Feather name="file-text" size={32} color={colors.textTertiary} />
                    <Text style={[type.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
                        No lyrics found
                    </Text>
                    <Button
                        label="Load lyrics…"
                        icon="upload"
                        variant="secondary"
                        size="md"
                        onPress={onPickLyrics}
                    />
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create({
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
});

export default NowPlayingLyrics;
