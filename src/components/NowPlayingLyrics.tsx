import React, { useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { Button, Touchable } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { useAudioStore } from '@/store/audioStore';
import { LyricLine } from '@/types';
import { metrics, type } from '@/theme/theme';

interface NowPlayingLyricsProps {
    lyrics: LyricLine[] | null;
    artSize: number;
    accentColor: string;
    onPickLyrics: () => void;
}

/**
 * Isolated lyrics viewer for NowPlayingScreen.
 *
 * Subscribes to `position` from `useAudioStore` only when mounted,
 * isolating active lyric highlighting and auto-scrolling from the main screen.
 */
export const NowPlayingLyrics: React.FC<NowPlayingLyricsProps> = React.memo(({
    lyrics,
    artSize,
    accentColor,
    onPickLyrics,
}) => {
    const { colors } = useTheme();
    const position = useAudioStore((s) => s.position);
    const seekTo = useAudioStore((s) => s.seekTo);
    const lyricsListRef = useRef<FlatList<LyricLine>>(null);

    // Active lyric line index
    const activeLyricIndex = useMemo(() => {
        if (!lyrics || lyrics.length === 0) return -1;
        let active = -1;
        for (let i = 0; i < lyrics.length; i++) {
            if (lyrics[i].time <= position) {
                active = i;
            } else {
                break;
            }
        }
        return active;
    }, [lyrics, position]);

    // Auto-scroll lyrics cleanly centered
    useEffect(() => {
        if (activeLyricIndex >= 0 && lyricsListRef.current) {
            lyricsListRef.current.scrollToIndex({
                index: activeLyricIndex,
                viewPosition: 0.5,
                animated: true,
            });
        }
    }, [activeLyricIndex]);

    return (
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
