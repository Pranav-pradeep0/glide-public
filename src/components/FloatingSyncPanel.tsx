import React, { useState, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    TextInput,
    type TextInputInstance,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import Feather from '@react-native-vector-icons/feather';
import { SubtitleCue } from '../types';
import { SubtitleSyncService, MatchResult } from '../services/SubtitleSyncService';
import type { AutoSyncResult } from '../services/SubtitleAutoSync';
import { describeAutoSync } from '../hooks/video-player/useSubtitleAutoSync';

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
    type,
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
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<TextInputInstance>(null);
    // Matching and offset calculation must use the same playback instant. Playback keeps
    // moving while the user reviews the matches.
    const matchReferenceTimeRef = useRef(0);

    // A successful Auto sync shows as the new value, with Undo. Only a failure needs words.
    const [autoNote, setAutoNote] = useState<string | null>(null);
    const [undoTo, setUndoTo] = useState<number | null>(null);

    const setValue = useCallback((ms: number) => {
        setAutoNote(null);
        setUndoTo(null);
        onChange(ms);
    }, [onChange]);

    const handleAuto = useCallback(async () => {
        if (!onAutoSync) {return;}
        const before = value;
        setAutoNote(null);
        setUndoTo(null);
        const result = await onAutoSync();
        if (!result) {return;}
        if (result.kind === 'synced') {
            if (result.delayMs !== before) {setUndoTo(before);}
        } else {
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

    const isSubtitle = type === 'subtitle' && subtitleCues.length > 0;
    const noun = type === 'audio' ? 'Audio plays' : 'Subtitles show';
    const caption = autoNote
        ?? (value === 0 ? 'No offset' : `${noun} ${(Math.abs(value) / 1000).toFixed(2)} s ${value > 0 ? 'later' : 'earlier'}`);

    const renderNudge = (ms: number) => (
        <Pressable
            key={ms}
            onPress={() => setValue(value + ms)}
            style={({ pressed }) => [styles.nudge, Math.abs(ms) < 500 && styles.nudgeFine, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${ms > 0 ? 'Later' : 'Earlier'} by ${Math.abs(ms)} milliseconds`}
        >
            <Text style={styles.nudgeText}>{ms > 0 ? '+' : '−'}{Math.abs(ms) / 1000}</Text>
        </Pressable>
    );

    return (
        <Animated.View
            style={styles.container}
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
            layout={LinearTransition.springify()}
            pointerEvents="box-none"
        >
            <View style={styles.card}>
                <View style={styles.headerRow}>
                    {searchMode ? (
                        <Pressable onPress={handleToggleSearch} hitSlop={10} style={styles.headerLeft} accessibilityLabel="Back">
                            <Feather name="chevron-left" size={18} color="#FFF" />
                            <Text style={styles.title}>Find the line you heard</Text>
                        </Pressable>
                    ) : (
                        <Text style={styles.title}>{type === 'audio' ? 'Audio sync' : 'Subtitle sync'}</Text>
                    )}
                    <View style={styles.headerRight}>
                        {!searchMode && (
                            <Pressable
                                onPress={() => setValue(0)}
                                disabled={value === 0}
                                hitSlop={8}
                                style={[styles.iconButton, value === 0 && styles.disabled]}
                                accessibilityLabel="Reset to zero"
                            >
                                <Feather name="rotate-ccw" size={15} color="#CCC" />
                            </Pressable>
                        )}
                        <Pressable onPress={onClose} hitSlop={8} style={styles.iconButton} accessibilityLabel="Close">
                            <Feather name="x" size={17} color="#CCC" />
                        </Pressable>
                    </View>
                </View>

                {!searchMode && (
                    <>
                        <View style={styles.stepper}>
                            {EARLIER_MS.map(renderNudge)}
                            <View style={styles.valueBox} accessibilityLiveRegion="polite">
                                <Text style={[styles.value, value === 0 && styles.valueZero]} numberOfLines={1} adjustsFontSizeToFit>
                                    {formatSeconds(value)}
                                </Text>
                                <Text style={styles.valueUnit}>seconds</Text>
                            </View>
                            {LATER_MS.map(renderNudge)}
                        </View>

                        <View style={styles.captionRow}>
                            <Text style={styles.caption} numberOfLines={2}>{caption}</Text>
                            {undoTo !== null && (
                                <Pressable onPress={() => setValue(undoTo)} hitSlop={10} accessibilityLabel="Undo auto sync">
                                    <Text style={styles.undo}>Undo</Text>
                                </Pressable>
                            )}
                        </View>

                        {isSubtitle && (
                            <View style={styles.actionRow}>
                                {onAutoSync && (
                                    <Pressable
                                        onPress={handleAuto}
                                        disabled={autoSyncRunning}
                                        style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && styles.pressed]}
                                        accessibilityLabel="Sync subtitles automatically from the audio"
                                    >
                                        {autoSyncRunning
                                            ? <ActivityIndicator size="small" color="#000" />
                                            : <Feather name="zap" size={15} color="#000" />}
                                        <Text style={[styles.actionText, styles.actionTextPrimary]}>
                                            {autoSyncRunning ? 'Syncing…' : 'Auto sync'}
                                        </Text>
                                    </Pressable>
                                )}
                                <Pressable
                                    onPress={handleToggleSearch}
                                    style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                                    accessibilityLabel="Pick the line you just heard"
                                >
                                    <Feather name="search" size={15} color="#FFF" />
                                    <Text style={styles.actionText}>Pick a line</Text>
                                </Pressable>
                            </View>
                        )}
                    </>
                )}

                {searchMode && (
                    <Animated.View entering={FadeIn.duration(200)} style={styles.searchArea}>
                        <View style={[styles.inputWrapper, isFocused && styles.inputWrapperFocused]}>
                            <Feather name="search" size={15} color={isFocused ? '#FFF' : '#777'} />
                            <TextInput
                                ref={inputRef}
                                style={styles.input}
                                placeholder="Type a few words you just heard"
                                placeholderTextColor="#777"
                                value={query}
                                onChangeText={handleSearch}
                                onFocus={() => setIsFocused(true)}
                                onBlur={() => setIsFocused(false)}
                                autoCorrect={false}
                                autoCapitalize="none"
                                selectionColor="#FFFFFF"
                            />
                            {query.length > 0 && (
                                <Pressable onPress={() => handleSearch('')} hitSlop={8} accessibilityLabel="Clear">
                                    <Feather name="x-circle" size={15} color="#777" />
                                </Pressable>
                            )}
                        </View>

                        {results.length > 0 && (
                            <ScrollView style={styles.resultsList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                                {results.map((item, index) => {
                                    const shift = SubtitleSyncService.calculateOffset(item.cue, matchReferenceTimeRef.current);
                                    return (
                                        <Pressable
                                            key={`${item.cue.startTime}-${index}`}
                                            style={({ pressed }) => [styles.resultItem, pressed && styles.resultPressed]}
                                            onPress={() => applySync(item)}
                                        >
                                            <View style={styles.resultBody}>
                                                <Text style={styles.resultText} numberOfLines={2}>
                                                    {item.cue.text.replace(/\n/g, ' ')}
                                                </Text>
                                                <Text style={styles.resultTime}>{formatMatchTime(item.cue.startTime)}</Text>
                                            </View>
                                            <Text style={styles.resultShift}>{formatSeconds(shift)} s</Text>
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        )}

                        {query.length >= 2 && results.length === 0 && (
                            <Text style={styles.emptyText}>No matching line near here</Text>
                        )}
                    </Animated.View>
                )}
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
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
        backgroundColor: 'rgba(20, 20, 20, 0.97)',
        borderRadius: 24,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
        gap: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255, 255, 255, 0.12)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
        elevation: 12,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: -6 },
    title: { color: '#FFF', fontSize: 15, fontWeight: '600' },
    iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    disabled: { opacity: 0.3 },
    pressed: { opacity: 0.55 },

    stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    nudge: {
        width: 48,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
    },
    nudgeFine: { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
    nudgeText: { color: '#FFF', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    valueBox: { flex: 1, alignItems: 'center' },
    value: { color: '#FFF', fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
    valueZero: { color: '#8A8A8A' },
    valueUnit: { color: '#777', fontSize: 11, marginTop: -2 },

    captionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: -4 },
    caption: { color: '#AAA', fontSize: 12, textAlign: 'center', flexShrink: 1 },
    undo: { color: '#FFF', fontSize: 12, fontWeight: '700' },

    actionRow: { flexDirection: 'row', gap: 8 },
    action: {
        flex: 1,
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 22,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    actionPrimary: { backgroundColor: '#FFFFFF' },
    actionText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
    actionTextPrimary: { color: '#000' },

    searchArea: { gap: 8 },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 44,
        paddingHorizontal: 14,
        borderRadius: 22,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    inputWrapperFocused: { borderColor: 'rgba(255, 255, 255, 0.28)' },
    input: { flex: 1, color: '#FFF', fontSize: 14, paddingVertical: 0 },
    resultsList: { maxHeight: 200 },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 10,
        borderRadius: 12,
    },
    resultPressed: { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
    resultBody: { flex: 1, gap: 2 },
    resultText: { color: '#EEE', fontSize: 14 },
    resultTime: { color: '#777', fontSize: 11, fontVariant: ['tabular-nums'] },
    resultShift: { color: '#FFF', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    emptyText: { color: '#777', fontSize: 12, textAlign: 'center', paddingVertical: 6 },
});
