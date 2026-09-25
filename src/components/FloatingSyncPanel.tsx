import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Pressable,
    TextInput,
    type TextInputInstance,
    ScrollView,
    ActivityIndicator,
    Alert,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SubtitleCue } from '../types';
import { SubtitleSyncService, MatchResult } from '../services/SubtitleSyncService';
import { SmartSyncIcon, AutoListenIcon } from './VideoPlayer/PlayerIcons';
import { AudioExtractor } from '../utils/AudioExtractor';
import { SpeechToTextService } from '../services/SpeechToTextService';
import { RECAP_STT_AVAILABLE } from '../utils/constants';
import type { AutoSyncResult } from '../services/SubtitleAutoSync';
import { describeAutoSync } from '../hooks/video-player/useSubtitleAutoSync';

/** Coarse on the outside, fine on the inside. */
const NUDGES_MS = [-500, -50, 50, 500];
import Feather from '@react-native-vector-icons/feather';

interface FloatingSyncPanelProps {
    type: 'audio' | 'subtitle';
    value: number; // in milliseconds
    onChange: (value: number) => void;
    onClose: () => void;
    subtitleCues?: SubtitleCue[];
    /** Read at the moment of an action; the player screen does not re-render on progress. */
    currentTimeRef: React.MutableRefObject<number>;
    videoPath?: string;
    subtitleLanguage?: string;
    /** Automatic sync from the audio (subtitles only). Applies its own result and reports it. */
    onAutoSync?: () => Promise<AutoSyncResult | null>;
    autoSyncRunning?: boolean;
}

export const FloatingSyncPanel: React.FC<FloatingSyncPanelProps> = ({
    type,
    value,
    onChange,
    onClose,
    subtitleCues = [],
    currentTimeRef,
    videoPath,
    subtitleLanguage,
    onAutoSync,
    autoSyncRunning = false,
}) => {
    const [searchMode, setSearchMode] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MatchResult[]>([]);
    const [isFocused, setIsFocused] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const inputRef = useRef<TextInputInstance>(null);
    // Matching and offset calculation must use the same playback instant. Playback keeps
    // moving while transcription runs and while the user reviews the matches.
    const matchReferenceTimeRef = useRef(0);

    // Seconds read better than milliseconds: "+0.19 s", not "+190 ms".
    const formattedValue = useMemo(() => {
        const sign = value > 0 ? '+' : '';
        return `${sign}${(value / 1000).toFixed(2)} s`;
    }, [value]);

    const nudge = useCallback((ms: number) => onChange(value + ms), [value, onChange]);

    // The last Auto result, shown inline, with Undo back to the value before it ran.
    const [autoStatus, setAutoStatus] = useState<{ text: string; ok: boolean; undoTo: number | null } | null>(null);
    const handleAuto = useCallback(async () => {
        if (!onAutoSync) {return;}
        const before = value;
        setAutoStatus(null);
        const result = await onAutoSync();
        if (!result) {return;}
        const ok = result.kind === 'synced';
        setAutoStatus({
            text: describeAutoSync(result),
            ok,
            undoTo: ok && result.delayMs !== before ? before : null,
        });
    }, [onAutoSync, value]);
    const handleUndo = useCallback(() => {
        if (autoStatus?.undoTo === null || autoStatus?.undoTo === undefined) {return;}
        onChange(autoStatus.undoTo);
        setAutoStatus(null);
    }, [autoStatus, onChange]);

    const handleReset = useCallback(() => {
        onChange(0);
    }, [onChange]);

    const handleToggleSearch = useCallback(() => {
        const next = !searchMode;
        setSearchMode(next);
        if (next) {
            setQuery('');
            setResults([]);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [searchMode]);

    const updateSearch = useCallback((text: string, referenceTime: number) => {
        setQuery(text);
        if (text.length >= 2 && subtitleCues.length > 0) {
            matchReferenceTimeRef.current = referenceTime;
            const matches = SubtitleSyncService.findMatchingCues(subtitleCues, text, referenceTime);
            setResults(matches);
        } else {
            setResults([]);
        }
    }, [subtitleCues]);

    const handleSearch = useCallback((text: string) => {
        updateSearch(text, currentTimeRef.current);
    }, [currentTimeRef, updateSearch]);

    const handleAutoListen = useCallback(async () => {
        if (!videoPath || isListening) {return;}

        try {
            setIsListening(true);
            setQuery(''); // Clear manual input or previous result
            setResults([]); // Clear previous matches immediately

            // Extract 10 seconds of audio around the current time
            const referenceTime = currentTimeRef.current;
            const extractStart = Math.max(0, referenceTime - 5);
            const audioClip = await AudioExtractor.extractAudioChunk(videoPath, extractStart, 10);

            if (audioClip) {
                // 1. SMART VAD: Check for silence before wasting API call
                const volume = await AudioExtractor.checkAudioVolume(audioClip);
                if (volume < -50) {
                    if (__DEV__) {console.log(`[SmartSync] Silence detected (${volume} dB). Skipping transcription.`);}
                    Alert.alert('No Speech Detected', 'It seems there was no clear speech in this segment. Please try again or type manually.');
                    setIsListening(false);
                    await AudioExtractor.cleanup();
                    return;
                }

                // Determine transcription strategy based on subtitle language
                let language = subtitleLanguage?.toLowerCase();
                let task: 'transcribe' | 'translate' = 'transcribe';

                // If subtitle is English, force translation from whatever language audio is
                if (language && (language === 'eng' || language === 'en' || language.includes('english'))) {
                    task = 'translate';
                    language = undefined; // Whisper auto-detects source language for translation
                } else if (language) {
                    // For native subtitles, try to transcribe in that specific language
                    // Groq expects ISO-639-1 (2 chars), but we might get 'eng', 'spa', etc.
                    // Mapping simple 3-char codes to 2-char where obvious
                    const map: Record<string, string> = {
                        'spa': 'es', 'fre': 'fr', 'fra': 'fr', 'ger': 'de', 'deu': 'de',
                        'ita': 'it', 'por': 'pt', 'rus': 'ru', 'jpn': 'ja', 'chi': 'zh',
                        'hin': 'hi', 'kor': 'ko', 'mal': 'ml',
                    };
                    if (map[language]) {
                        language = map[language];
                    } else if (language.length === 3) {
                        // Optimistic fallback: take first 2 chars if not in map
                        language = language.substring(0, 2);
                    }
                }

                if (__DEV__) {console.log(`[SmartSync] Auto-listening with task: ${task}, language: ${language || 'auto'}`);}

                const text = await SpeechToTextService.transcribe(audioClip, {
                    language,
                    task,
                });

                if (text && text.trim()) {
                    updateSearch(text, referenceTime);
                } else {
                    setQuery('');
                    setResults([]);
                }
                // Cleanup temp file
                await AudioExtractor.cleanup();
            }
        } catch (error) {
            console.error('[FloatingSyncPanel] Auto Listen failed:', error);
            setQuery('');
        } finally {
            setIsListening(false);
        }
    }, [videoPath, currentTimeRef, isListening, updateSearch, subtitleLanguage]);

    const applySync = useCallback((match: MatchResult) => {
        const offset = SubtitleSyncService.calculateOffset(match.cue, matchReferenceTimeRef.current);
        onChange(offset);
        setSearchMode(false);
        setQuery('');
        setResults([]);
    }, [onChange]);

    const formatMatchTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')} `;
    };

    const isSubtitle = type === 'subtitle' && subtitleCues.length > 0;

    return (
        <Animated.View
            style={styles.container}
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
            layout={LinearTransition.springify()}
            pointerEvents="box-none"
        >
            <View style={styles.card}>
                {/* Header: what is being synced, by how much, reset and close */}
                <View style={styles.headerRow}>
                    {searchMode ? (
                        <Pressable onPress={handleToggleSearch} hitSlop={10} style={styles.headerLeft} accessibilityLabel="Back">
                            <Feather name="chevron-left" size={18} color="#FFF" />
                            <Text style={styles.title}>Pick the line you heard</Text>
                        </Pressable>
                    ) : (
                        <View style={styles.headerLeft}>
                            <Feather name={type === 'audio' ? 'volume-2' : 'message-square'} size={15} color="#AAA" />
                            <Text style={styles.title}>{type === 'audio' ? 'Audio sync' : 'Subtitle sync'}</Text>
                        </View>
                    )}
                    <View style={styles.headerRight}>
                        <Text style={[styles.valueChip, value !== 0 && styles.valueChipActive]}>{formattedValue}</Text>
                        <Pressable
                            onPress={handleReset}
                            disabled={value === 0}
                            hitSlop={10}
                            style={[styles.iconButton, value === 0 && styles.disabled]}
                            accessibilityLabel="Reset to zero"
                        >
                            <Feather name="rotate-ccw" size={14} color="#CCC" />
                        </Pressable>
                        <Pressable onPress={onClose} hitSlop={10} style={styles.iconButton} accessibilityLabel="Close">
                            <Feather name="x" size={16} color="#CCC" />
                        </Pressable>
                    </View>
                </View>

                {!searchMode && (
                    <>
                        {/* Nudges: coarse on the outside, fine on the inside */}
                        <View style={styles.nudgeRow}>
                            {NUDGES_MS.map(ms => (
                                <Pressable
                                    key={ms}
                                    onPress={() => nudge(ms)}
                                    style={({ pressed }) => [styles.nudge, pressed && styles.pressed]}
                                    accessibilityLabel={`${ms > 0 ? 'Later' : 'Earlier'} by ${Math.abs(ms)} milliseconds`}
                                >
                                    <Text style={styles.nudgeText}>
                                        {ms > 0 ? '+' : '−'}{(Math.abs(ms) / 1000).toFixed(Math.abs(ms) >= 500 ? 1 : 2)}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                        <Text style={styles.hint}>
                            {type === 'audio' ? '+ plays audio later' : '+ shows subtitles later'}
                        </Text>

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
                                            : <Feather name="zap" size={16} color="#000" />}
                                        <View>
                                            <Text style={[styles.actionTitle, styles.actionTitlePrimary]}>
                                                {autoSyncRunning ? 'Listening…' : 'Auto sync'}
                                            </Text>
                                            <Text style={styles.actionSubPrimary}>From the audio</Text>
                                        </View>
                                    </Pressable>
                                )}
                                <Pressable
                                    onPress={handleToggleSearch}
                                    style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                                    accessibilityLabel="Pick the line you just heard"
                                >
                                    <SmartSyncIcon size={16} active={false} color="#FFF" />
                                    <View>
                                        <Text style={styles.actionTitle}>Pick a line</Text>
                                        <Text style={styles.actionSub}>Smart Sync</Text>
                                    </View>
                                </Pressable>
                            </View>
                        )}

                        {autoStatus && !autoSyncRunning && (
                            <Animated.View entering={FadeIn.duration(150)} style={styles.statusRow}>
                                <Feather
                                    name={autoStatus.ok ? 'check-circle' : 'info'}
                                    size={14}
                                    color={autoStatus.ok ? '#4ADE80' : '#AAA'}
                                />
                                <Text style={styles.statusText}>{autoStatus.text}</Text>
                                {autoStatus.undoTo !== null && (
                                    <Pressable onPress={handleUndo} hitSlop={10} accessibilityLabel="Undo auto sync">
                                        <Text style={styles.undo}>Undo</Text>
                                    </Pressable>
                                )}
                            </Animated.View>
                        )}
                    </>
                )}

                {/* Pick a line: type or listen, then choose the matching subtitle */}
                {searchMode && (
                    <Animated.View entering={FadeIn.duration(200)} style={styles.searchArea}>
                        <View style={[styles.inputWrapper, isFocused && styles.inputWrapperFocused]}>
                            <Feather name="search" size={14} color={isFocused ? '#FFF' : '#777'} />
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
                                    <Feather name="x-circle" size={14} color="#777" />
                                </Pressable>
                            )}
                            {type === 'subtitle' && videoPath && RECAP_STT_AVAILABLE && (
                                <TouchableOpacity
                                    style={[styles.listenButton, isListening && styles.listenButtonActive]}
                                    onPress={handleAutoListen}
                                    disabled={isListening}
                                    activeOpacity={0.7}
                                    accessibilityLabel="Listen to the last few seconds"
                                >
                                    <AutoListenIcon size={16} color="#FFFFFF" active={isListening} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {isListening && (
                            <View style={styles.listeningState}>
                                <ActivityIndicator size="small" color="#FFFFFF" />
                                <Text style={styles.listeningText}>Listening to the last few seconds…</Text>
                            </View>
                        )}

                        {!isListening && results.length > 0 && (
                            <ScrollView style={styles.resultsList} showsVerticalScrollIndicator={false}>
                                {results.map((item, index) => {
                                    const shift = SubtitleSyncService.calculateOffset(item.cue, matchReferenceTimeRef.current) / 1000;
                                    return (
                                        <Pressable
                                            key={`${item.cue.startTime}-${index}`}
                                            style={({ pressed }) => [styles.resultItem, pressed && styles.pressed]}
                                            onPress={() => applySync(item)}
                                        >
                                            <Text style={styles.resultTime}>{formatMatchTime(item.cue.startTime)}</Text>
                                            <Text style={styles.resultText} numberOfLines={2}>
                                                {item.cue.text.replace(/\n/g, ' ')}
                                            </Text>
                                            <Text style={styles.resultShift}>
                                                {shift > 0 ? '+' : ''}{shift.toFixed(1)} s
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        )}

                        {!isListening && query.length >= 2 && results.length === 0 && (
                            <Text style={styles.noResultsText}>No matching line near here</Text>
                        )}
                        {!isListening && query.length < 2 && (
                            <Text style={styles.noResultsText}>
                                {RECAP_STT_AVAILABLE ? 'Or tap the mic to listen for you' : 'Matches appear as you type'}
                            </Text>
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
        maxWidth: 440,
        backgroundColor: 'rgba(18, 18, 18, 0.96)',
        borderRadius: 20,
        padding: 14,
        gap: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255, 255, 255, 0.14)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
        elevation: 10,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { color: '#FFF', fontSize: 14, fontWeight: '600' },
    valueChip: {
        color: '#AAA',
        fontSize: 13,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        overflow: 'hidden',
    },
    valueChipActive: { color: '#FFF', backgroundColor: 'rgba(255, 255, 255, 0.14)' },
    iconButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    disabled: { opacity: 0.35 },
    pressed: { opacity: 0.6 },
    nudgeRow: { flexDirection: 'row', gap: 8 },
    nudge: {
        flex: 1,
        height: 38,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    nudgeText: { color: '#FFF', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    hint: { color: '#777', fontSize: 11, textAlign: 'center', marginTop: -6 },
    actionRow: { flexDirection: 'row', gap: 8 },
    action: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    actionPrimary: { backgroundColor: '#FFFFFF' },
    actionTitle: { color: '#FFF', fontSize: 13, fontWeight: '700' },
    actionTitlePrimary: { color: '#000' },
    actionSub: { color: '#999', fontSize: 11 },
    actionSubPrimary: { color: '#555', fontSize: 11 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusText: { color: '#DDD', fontSize: 12, flex: 1 },
    undo: { color: '#FFF', fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
    searchArea: { gap: 10 },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 42,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    inputWrapperFocused: { borderColor: 'rgba(255, 255, 255, 0.3)' },
    input: { flex: 1, color: '#FFF', fontSize: 14, paddingVertical: 0 },
    listenButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
    },
    listenButtonActive: { backgroundColor: '#E53935' },
    listeningState: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6 },
    listeningText: { color: '#CCC', fontSize: 12 },
    resultsList: { maxHeight: 180 },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 4,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    },
    resultTime: { color: '#777', fontSize: 11, fontVariant: ['tabular-nums'], width: 40 },
    resultText: { color: '#EEE', fontSize: 13, flex: 1 },
    resultShift: { color: '#FFF', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
    noResultsText: { color: '#777', fontSize: 12, textAlign: 'center', paddingVertical: 4 },
});
