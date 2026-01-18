import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Pressable,
    TextInput,
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
import Feather from '@react-native-vector-icons/feather';

interface FloatingSyncPanelProps {
    type: 'audio' | 'subtitle';
    value: number; // in milliseconds
    onChange: (value: number) => void;
    onClose: () => void;
    subtitleCues?: SubtitleCue[];
    currentTime?: number;
    videoPath?: string;
    subtitleLanguage?: string;
}

export const FloatingSyncPanel: React.FC<FloatingSyncPanelProps> = ({
    type,
    value,
    onChange,
    onClose,
    subtitleCues = [],
    currentTime = 0,
    videoPath,
    subtitleLanguage,
}) => {
    const [searchMode, setSearchMode] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MatchResult[]>([]);
    const [isFocused, setIsFocused] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const inputRef = useRef<TextInput>(null);

    // Format value with sign and unit
    const formattedValue = useMemo(() => {
        const sign = value > 0 ? '+' : '';
        return `${sign}${value} ms`;
    }, [value]);

    const handleIncrement = useCallback(() => {
        onChange(value + 50);
    }, [value, onChange]);

    const handleDecrement = useCallback(() => {
        onChange(value - 50);
    }, [value, onChange]);

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

    const handleSearch = useCallback((text: string) => {
        setQuery(text);
        if (text.length >= 2 && subtitleCues.length > 0) {
            const matches = SubtitleSyncService.findMatchingCues(subtitleCues, text, currentTime);
            setResults(matches);
        } else {
            setResults([]);
        }
    }, [subtitleCues, currentTime]);

    const handleAutoListen = useCallback(async () => {
        if (!videoPath || isListening) return;

        try {
            setIsListening(true);
            setQuery(''); // Clear manual input or previous result
            setResults([]); // Clear previous matches immediately

            // Extract 10 seconds of audio around the current time
            const extractStart = Math.max(0, currentTime - 5);
            const audioClip = await AudioExtractor.extractAudioChunk(videoPath, extractStart, 10);

            if (audioClip) {
                // 1. SMART VAD: Check for silence before wasting API call
                const volume = await AudioExtractor.checkAudioVolume(audioClip);
                if (volume < -50) {
                    console.log(`[SmartSync] Silence detected (${volume} dB). Skipping transcription.`);
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
                        'hin': 'hi', 'kor': 'ko', 'mal': 'ml'
                    };
                    if (map[language]) {
                        language = map[language];
                    } else if (language.length === 3) {
                        // Optimistic fallback: take first 2 chars if not in map
                        language = language.substring(0, 2);
                    }
                }

                console.log(`[SmartSync] Auto-listening with task: ${task}, language: ${language || 'auto'}`);

                const text = await SpeechToTextService.transcribe(audioClip, {
                    language,
                    task
                });

                if (text && text.trim()) {
                    // This will trigger the search with the fresh text
                    handleSearch(text);
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
    }, [videoPath, currentTime, isListening, handleSearch, subtitleLanguage]);

    const applySync = useCallback((match: MatchResult) => {
        const offset = SubtitleSyncService.calculateOffset(match.cue, currentTime);
        onChange(offset);
        setSearchMode(false);
        setQuery('');
        setResults([]);
    }, [currentTime, onChange]);

    const formatMatchTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')} `;
    };

    return (
        <Animated.View
            style={[styles.container, searchMode && styles.containerExpanded]}
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
            layout={LinearTransition.springify()}
            pointerEvents="box-none"
        >
            <View style={[styles.pill, searchMode && styles.pillExpanded]}>
                {/* Standard Controls Row */}
                <View style={styles.mainRow}>
                    {/* Header / Type Indicator */}
                    <View style={styles.header}>
                        <Feather
                            name={type === 'audio' ? 'mic' : 'message-square'}
                            size={14}
                            color="#CCCCCC"
                        />
                        <Text style={styles.label}>
                            {type === 'audio' ? 'Audio Sync' : 'Subtitle Sync'}
                        </Text>
                    </View>

                    {/* Center Title for Search Mode */}
                    {searchMode && (
                        <View style={styles.searchTitleContainer}>
                            <Text style={styles.searchTitleText}>Smart Sync</Text>
                        </View>
                    )}

                    {/* Controls Row */}
                    {!searchMode && (
                        <View style={styles.controls}>
                            <Pressable
                                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                                onPress={handleDecrement}
                                hitSlop={12}
                            >
                                <Feather name="minus" size={16} color="#FFFFFF" />
                            </Pressable>

                            <View style={styles.valueContainer}>
                                <Text style={[
                                    styles.valueText,
                                    value !== 0 && styles.valueTextActive
                                ]}>
                                    {formattedValue}
                                </Text>
                            </View>

                            <Pressable
                                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                                onPress={handleIncrement}
                                hitSlop={12}
                            >
                                <Feather name="plus" size={16} color="#FFFFFF" />
                            </Pressable>
                        </View>
                    )}

                    {/* Smart Sync Button (only when not searching) */}
                    {type === 'subtitle' && subtitleCues.length > 0 && !searchMode && (
                        <View style={styles.smartSection}>
                            <View style={styles.verticalDivider} />
                            <Pressable
                                style={({ pressed }) => [
                                    styles.smartButton,
                                    pressed && styles.buttonPressed
                                ]}
                                onPress={handleToggleSearch}
                                hitSlop={8}
                            >
                                <SmartSyncIcon size={20} active={false} color="#CCCCCC" />
                                <Text style={styles.smartText}>
                                    Smart Sync
                                </Text>
                            </Pressable>
                        </View>
                    )}

                    <View style={styles.actions}>
                        {!searchMode ? (
                            <>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.actionButton,
                                        pressed && styles.buttonPressed,
                                        value === 0 && styles.disabledButton
                                    ]}
                                    onPress={handleReset}
                                    disabled={value === 0}
                                >
                                    <Feather name="rotate-ccw" size={12} color={value === 0 ? '#666' : '#999'} />
                                </Pressable>

                                <View style={styles.divider} />
                            </>
                        ) : (
                            <>
                                <Pressable
                                    style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}
                                    onPress={handleToggleSearch}
                                    hitSlop={8}
                                >
                                    <Feather name="chevron-left" size={18} color="#CCCCCC" />
                                </Pressable>

                                <View style={styles.divider} />
                            </>
                        )}

                        <Pressable
                            style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}
                            onPress={onClose}
                            hitSlop={8}
                        >
                            <Feather name="x" size={14} color="#FFFFFF" />
                        </Pressable>
                    </View>
                </View>

                {/* Search Area */}
                {searchMode && (
                    <Animated.View
                        entering={FadeIn.duration(200)}
                        style={styles.searchArea}
                    >
                        <View style={[
                            styles.inputWrapper,
                            isFocused && styles.inputWrapperFocused
                        ]}>
                            <Feather name="search" size={14} color={isFocused ? '#FFF' : '#666'} style={styles.searchIcon} />
                            <TextInput
                                ref={inputRef}
                                style={styles.input}
                                placeholder="Type what you just heard..."
                                placeholderTextColor="#666"
                                value={query}
                                onChangeText={handleSearch}
                                onFocus={() => setIsFocused(true)}
                                onBlur={() => setIsFocused(false)}
                                autoCorrect={false}
                                autoCapitalize="none"
                                selectionColor="#FFFFFF"
                            />
                            {query.length > 0 && (
                                <Pressable
                                    onPress={() => handleSearch('')}
                                    style={styles.clearButton}
                                    hitSlop={8}
                                >
                                    <Feather name="x-circle" size={14} color="#666" />
                                </Pressable>
                            )}

                            {type === 'subtitle' && videoPath && (
                                <TouchableOpacity
                                    style={[styles.listenButton, isListening && styles.listenButtonActive]}
                                    onPress={handleAutoListen}
                                    disabled={isListening}
                                    activeOpacity={0.7}
                                >
                                    <AutoListenIcon size={16} color="#FFFFFF" active={isListening} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {isListening && (
                            <View style={styles.listeningState}>
                                <ActivityIndicator size="small" color="#FFFFFF" style={styles.listeningSpinner} />
                                <Text style={styles.listeningText}>Processing audio...</Text>
                            </View>
                        )}

                        {!isListening && results.length > 0 && (
                            <ScrollView style={styles.resultsList} showsVerticalScrollIndicator={false}>
                                {results.map((item, index) => {
                                    return (
                                        <Pressable
                                            key={`${item.cue.startTime}-${index}`}
                                            style={({ pressed }) => [
                                                styles.resultItem,
                                                pressed && styles.resultItemPressed
                                            ]}
                                            onPress={() => applySync(item)}
                                        >
                                            <View style={styles.resultContent}>
                                                <Text style={styles.resultTime}>{formatMatchTime(item.cue.startTime)}</Text>

                                                <Text style={styles.resultText} numberOfLines={1}>
                                                    {item.cue.text.replace(/\n/g, ' ')}
                                                </Text>
                                            </View>
                                            <Feather name="chevron-right" size={14} color="#666" />
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        )}

                        {!isListening && query.length >= 2 && results.length === 0 && (
                            <View style={styles.noResults}>
                                <Text style={styles.noResultsText}>No matches found near here</Text>
                            </View>
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
        bottom: 100,
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
    },
    containerExpanded: {
        bottom: 120,
    },
    pill: {
        backgroundColor: 'rgba(20, 20, 20, 0.95)',
        borderRadius: 24,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4.65,
        elevation: 8,
        minWidth: 380,
    },
    pillExpanded: {
        borderRadius: 16,
        paddingVertical: 12,
        width: '90%',
        maxWidth: 400,
    },
    mainRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingRight: 8,
        borderRightWidth: 1,
        borderRightColor: 'rgba(255, 255, 255, 0.1)',
    },
    label: {
        color: '#CCCCCC',
        fontSize: 12,
        fontWeight: '600',
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 16,
        padding: 4,
    },
    button: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonPressed: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        transform: [{ scale: 0.95 }],
    },
    disabledButton: {
        opacity: 0.5,
    },
    valueContainer: {
        minWidth: 60,
        alignItems: 'center',
        justifyContent: 'center',
    },
    valueText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontFamily: 'monospace',
        fontWeight: '500',
    },
    valueTextActive: {
        color: '#4CAF50',
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 8,
        borderLeftWidth: 1,
        borderLeftColor: 'rgba(255, 255, 255, 0.1)',
    },
    actionButton: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
    },
    actionButtonActive: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    divider: {
        width: 1,
        height: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    smartSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    verticalDivider: {
        width: 1,
        height: 24,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        marginHorizontal: 4,
    },
    smartButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    smartButtonActive: {
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
    },
    searchTitleContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    searchTitleText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    smartText: {
        color: '#CCCCCC',
        fontSize: 12,
        fontWeight: '500',
    },
    smartTextActive: {
        color: '#FFFFFF',
    },
    searchArea: {
        marginTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.05)',
        paddingTop: 12,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        borderRadius: 12,
        paddingLeft: 10,
        paddingRight: 3,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    inputWrapperFocused: {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderColor: 'rgba(255, 255, 255, 0.2)',
    },
    searchIcon: {
        marginRight: 8,
    },
    input: {
        flex: 1,
        color: '#FFF',
        fontSize: 14,
        paddingVertical: 10,
    },
    clearButton: {
        padding: 4,
        marginRight: 4,
    },
    listenButton: {
        padding: 8,
        marginLeft: 4,
        borderRadius: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderLeftWidth: 1,
        borderLeftColor: 'rgba(255, 255, 255, 0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    listenButtonActive: {
        backgroundColor: 'rgba(255, 255, 255, 0.45)',
    },
    resultsList: {
        marginTop: 8,
        maxHeight: 150,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        marginBottom: 2,
    },
    resultItemPressed: {
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    resultContent: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    resultTime: {
        color: '#4CAF50',
        fontSize: 11,
        fontFamily: 'monospace',
    },
    resultText: {
        flex: 1,
        color: '#DDD',
        fontSize: 13,
    },
    noResults: {
        paddingVertical: 12,
        alignItems: 'center',
    },
    noResultsText: {
        color: '#666',
        fontSize: 12,
        fontStyle: 'italic',
    },
    listeningState: {
        paddingVertical: 32,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    listeningSpinner: {
        opacity: 0.8,
    },
    listeningText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '500',
        opacity: 0.6,
    },
});
