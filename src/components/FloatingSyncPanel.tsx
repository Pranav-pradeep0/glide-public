import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, type TextInputInstance, ScrollView } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import Feather from '@react-native-vector-icons/feather';
import { Button, IconButton, Touchable } from '@/components/ui';
import { haptic } from '@/native/HapticModule';
import { metrics, motion, playerTheme, type } from '@/theme/theme';
import { SubtitleCue } from '../types';
import { SubtitleSyncService, MatchResult } from '../services/SubtitleSyncService';
import type { AutoSyncResult } from '../services/SubtitleAutoSync';
import { describeAutoSync } from '../hooks/video-player/useSubtitleAutoSync';

const { colors } = playerTheme;

/** Earlier on the left, later on the right; coarse on the outside, fine on the inside. */
const EARLIER_MS = [-500, -50];
const LATER_MS = [50, 500];

interface FloatingSyncPanelProps {
    type: 'audio' | 'subtitle';
    value: number; // in milliseconds
    onChange: (value: number) => void;
    onClose: () => void;
    subtitleCues?: SubtitleCue[];
    /** Read at the moment of an action; the player screen does not re-render on progress. */
    currentTimeRef: React.MutableRefObject<number>;
    /** Automatic sync from the audio (subtitles only). Applies its own result and reports it. */
    onAutoSync?: () => Promise<AutoSyncResult | null>;
    autoSyncRunning?: boolean;
}

const formatSeconds = (ms: number) => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${(Math.abs(ms) / 1000).toFixed(2)}`;

const formatMatchTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export const FloatingSyncPanel: React.FC<FloatingSyncPanelProps> = ({
    type: syncType,
    value,
    onChange,
    onClose,
    subtitleCues = [],
    currentTimeRef,
    onAutoSync,
    autoSyncRunning = false,
}) => {
    const [searchMode, setSearchMode] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MatchResult[]>([]);
    const inputRef = useRef<TextInputInstance>(null);
    // Matching and offset calculation must use the same playback instant. Playback keeps
    // moving while the user reviews the matches.
    const matchReferenceTimeRef = useRef(0);

    // A successful Auto sync shows as the new value, with Undo. Only a failure needs words.
    const [autoNote, setAutoNote] = useState<string | null>(null);
    const [undoTo, setUndoTo] = useState<number | null>(null);

    const setValue = useCallback((ms: number) => {
        // One tick as the offset passes through zero.
        if ((value < 0 && ms >= 0) || (value > 0 && ms <= 0)) { haptic('segmentTick'); }
        setAutoNote(null);
        setUndoTo(null);
        onChange(ms);
    }, [onChange, value]);

    const handleAuto = useCallback(async () => {
        if (!onAutoSync) {return;}
        const before = value;
        setAutoNote(null);
        setUndoTo(null);
        const result = await onAutoSync();
        if (!result) {return;}
        if (result.kind === 'synced') {
            haptic('confirm');
            if (result.delayMs !== before) {setUndoTo(before);}
        } else {
            haptic('reject');
            setAutoNote(describeAutoSync(result));
        }
    }, [onAutoSync, value]);

    const handleToggleSearch = useCallback(() => {
        const next = !searchMode;
        setSearchMode(next);
        if (next) {
            setQuery('');
            setResults([]);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [searchMode]);

    const handleSearch = useCallback((text: string) => {
        setQuery(text);
        if (text.length >= 2 && subtitleCues.length > 0) {
            matchReferenceTimeRef.current = currentTimeRef.current;
            setResults(SubtitleSyncService.findMatchingCues(subtitleCues, text, currentTimeRef.current));
        } else {
            setResults([]);
        }
    }, [subtitleCues, currentTimeRef]);

    const applySync = useCallback((match: MatchResult) => {
        setValue(SubtitleSyncService.calculateOffset(match.cue, matchReferenceTimeRef.current));
        setSearchMode(false);
        setQuery('');
        setResults([]);
    }, [setValue]);

    const isSubtitle = syncType === 'subtitle' && subtitleCues.length > 0;
    const noun = syncType === 'audio' ? 'Audio plays' : 'Subtitles show';
    const caption = autoNote
        ?? (value === 0 ? 'No offset' : `${noun} ${(Math.abs(value) / 1000).toFixed(2)} s ${value > 0 ? 'later' : 'earlier'}`);

    const renderNudge = (ms: number) => (
        <Touchable
            key={ms}
            onPress={() => setValue(value + ms)}
            onPlayer
            style={[styles.nudge, Math.abs(ms) < 500 && styles.nudgeFine]}
            accessibilityRole="button"
            accessibilityLabel={`${ms > 0 ? 'Later' : 'Earlier'} by ${Math.abs(ms)} milliseconds`}
        >
            <Text style={[type.label, styles.nudgeText]}>{ms > 0 ? '+' : '−'}{Math.abs(ms) / 1000}</Text>
        </Touchable>
    );

    return (
        <Animated.View
            style={styles.container}
            entering={FadeIn.duration(motion.fadeIn)}
            exiting={FadeOut.duration(motion.fadeOut)}
            layout={LinearTransition.springify().mass(motion.spatial.mass).stiffness(motion.spatial.stiffness).damping(motion.spatial.damping)}
            pointerEvents="box-none"
        >
            <View style={styles.card}>
                <View style={styles.headerRow}>
                    {searchMode ? (
                        <View style={styles.headerLeft}>
                            <IconButton icon="chevron-left" onPress={handleToggleSearch} accessibilityLabel="Back" onPlayer style={styles.headerBack} />
                            <Text style={[type.heading, styles.title]} numberOfLines={1}>Find the line you heard</Text>
                        </View>
                    ) : (
                        <Text style={[type.heading, styles.title]}>{syncType === 'audio' ? 'Audio sync' : 'Subtitle sync'}</Text>
                    )}
                    <View style={styles.headerRight}>
                        {!searchMode && (
                            <IconButton
                                icon="rotate-ccw"
                                iconSize={18}
                                color={colors.textSecondary}
                                onPress={() => setValue(0)}
                                disabled={value === 0}
                                accessibilityLabel="Reset to zero"
                                onPlayer
                            />
                        )}
                        <IconButton icon="x" iconSize={20} color={colors.textSecondary} onPress={onClose} accessibilityLabel="Close" onPlayer />
                    </View>
                </View>

                {!searchMode && (
                    <>
                        <View style={styles.stepper}>
                            {EARLIER_MS.map(renderNudge)}
                            <View style={styles.valueBox} accessibilityLiveRegion="polite">
                                <Text style={[type.hero, styles.value, value === 0 && styles.valueZero]} numberOfLines={1} adjustsFontSizeToFit>
                                    {formatSeconds(value)}
                                </Text>
                                <Text style={[type.caption, styles.valueUnit]}>seconds</Text>
                            </View>
                            {LATER_MS.map(renderNudge)}
                        </View>

                        <View style={styles.captionRow}>
                            <Text style={[type.caption, styles.caption]} numberOfLines={2}>{caption}</Text>
                            {undoTo !== null && (
                                <Button label="Undo" variant="ghost" onPress={() => setValue(undoTo)} accessibilityLabel="Undo auto sync" onPlayer />
                            )}
                        </View>

                        {isSubtitle && (
                            <View style={styles.actionRow}>
                                {onAutoSync && (
                                    <Button
                                        label={autoSyncRunning ? 'Syncing…' : 'Auto sync'}
                                        variant="primary"
                                        icon="zap"
                                        loading={autoSyncRunning}
                                        onPress={handleAuto}
                                        accessibilityLabel="Sync subtitles automatically from the audio"
                                        onPlayer
                                        style={styles.flex}
                                    />
                                )}
                                <Button
                                    label="Pick a line"
                                    icon="search"
                                    onPress={handleToggleSearch}
                                    accessibilityLabel="Pick the line you just heard"
                                    onPlayer
                                    style={styles.flex}
                                />
                            </View>
                        )}
                    </>
                )}

                {searchMode && (
                    <Animated.View entering={FadeIn.duration(motion.fadeIn)} style={styles.searchArea}>
                        <View style={styles.inputWrapper}>
                            <Feather name="search" size={16} color={colors.textTertiary} />
                            <TextInput
                                ref={inputRef}
                                style={[type.body, styles.input]}
                                placeholder="Type a few words you just heard"
                                placeholderTextColor={colors.textTertiary}
                                value={query}
                                onChangeText={handleSearch}
                                autoCorrect={false}
                                autoCapitalize="none"
                                selectionColor={colors.primary}
                            />
                            {query.length > 0 && (
                                <IconButton icon="x" iconSize={16} color={colors.textTertiary} onPress={() => handleSearch('')} accessibilityLabel="Clear" onPlayer />
                            )}
                        </View>

                        {results.length > 0 && (
                            <ScrollView style={styles.resultsList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                                {results.map((item, index) => {
                                    const shift = SubtitleSyncService.calculateOffset(item.cue, matchReferenceTimeRef.current);
                                    return (
                                        <Touchable
                                            key={`${item.cue.startTime}-${index}`}
                                            scaleTo={1}
                                            stateLayer
                                            onPlayer
                                            style={styles.resultItem}
                                            onPress={() => applySync(item)}
                                        >
                                            <View style={styles.resultBody}>
                                                <Text style={[type.row, styles.resultText]} numberOfLines={2}>
                                                    {item.cue.text.replace(/\n/g, ' ')}
                                                </Text>
                                                <Text style={[type.caption, styles.resultTime]}>{formatMatchTime(item.cue.startTime)}</Text>
                                            </View>
                                            <Text style={[type.label, styles.resultShift]}>{formatSeconds(shift)} s</Text>
                                        </Touchable>
                                    );
                                })}
                            </ScrollView>
                        )}

                        {query.length >= 2 && results.length === 0 && (
                            <Text style={[type.caption, styles.emptyText]}>No matching line near here</Text>
                        )}
                    </Animated.View>
                )}
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    flex: { flex: 1 },
    container: {
        position: 'absolute',
        bottom: 96,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 2000,
    },
    card: {
        width: '92%',
        maxWidth: 420,
        backgroundColor: colors.cardElevated,
        borderRadius: metrics.radius.card,
        paddingHorizontal: metrics.space.lg,
        paddingTop: metrics.space.sm,
        paddingBottom: metrics.space.lg,
        gap: metrics.space.md,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: metrics.touch },
    headerLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
    headerBack: { marginLeft: -metrics.space.sm },
    headerRight: { flexDirection: 'row', alignItems: 'center', marginRight: -metrics.space.sm },
    title: { color: colors.text },

    stepper: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.xs },
    nudge: {
        width: metrics.touch,
        height: metrics.touch,
        borderRadius: metrics.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.fillStrong,
    },
    nudgeFine: { backgroundColor: colors.fill },
    nudgeText: { color: colors.text, fontVariant: ['tabular-nums'] },
    valueBox: { flex: 1, alignItems: 'center' },
    value: { color: colors.text },
    valueZero: { color: colors.textTertiary },
    valueUnit: { color: colors.textTertiary, marginTop: -2 },

    captionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: metrics.space.sm },
    caption: { color: colors.textSecondary, textAlign: 'center', flexShrink: 1 },

    actionRow: { flexDirection: 'row', gap: metrics.space.sm },

    searchArea: { gap: metrics.space.sm },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.sm,
        height: 44,
        paddingLeft: 14,
        paddingRight: metrics.space.xs,
        borderRadius: metrics.radius.pill,
        backgroundColor: colors.fill,
    },
    input: { flex: 1, color: colors.text, paddingVertical: 0 },
    resultsList: { maxHeight: 200 },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
        minHeight: metrics.touch,
        paddingVertical: metrics.space.sm,
        paddingHorizontal: metrics.space.sm,
        borderRadius: metrics.radius.md,
    },
    resultBody: { flex: 1, gap: 2 },
    resultText: { color: colors.text },
    resultTime: { color: colors.textTertiary, fontVariant: ['tabular-nums'] },
    resultShift: { color: colors.text, fontVariant: ['tabular-nums'] },
    emptyText: { color: colors.textTertiary, textAlign: 'center', paddingVertical: metrics.space.sm },
});
