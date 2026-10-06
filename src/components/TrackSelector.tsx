import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
    StyleSheet,
    Text,
    View,
    ActivityIndicator,
    TextInput,
    ScrollView,
    useWindowDimensions,
} from 'react-native';
import { FilenameParser } from '../utils/FilenameParser';
import { FlashList } from '@shopify/flash-list';
import type { ListRenderItem } from '@shopify/flash-list';
import Feather from '@react-native-vector-icons/feather';
import { SubtitlePickerService } from '../services/SubtitlePickerService';
import { SubtitleResult, SubtitleCue } from '../types';
import { searchAllSubtitles, downloadSubtitle } from '../utils/subdlApi';
import { SubtitleParser } from '../utils/SubtitleParser';
import { SubtitleSelectionService } from '../services/SubtitleSelectionService';
import { EQUALIZER_PRESETS, EQUALIZER_BANDS } from '../config/equalizerPresets';
import { isAbortError } from '../utils/network';
import { LANGUAGES } from '../utils/languages';
import { VerticalSlider } from './VerticalSlider';
import { Button, Chip, IconButton, ListGroup, ListRow, Touchable } from './ui';
import { SidePanel } from './VideoPlayer/SidePanel';
import { metrics, playerTheme, type as typo } from '@/theme/theme';

const { colors } = playerTheme;

type SubtitleTab = 'embedded' | 'external' | 'online';
type AudioTab = 'tracks' | 'effects';

// Common subtitle languages for selection
const SUBTITLE_LANGUAGES = [
    { code: 'ar', label: 'Arabic' },
    { code: 'br_pt', label: 'Brazilian Portuguese' },
    { code: 'da', label: 'Danish' },
    { code: 'nl', label: 'Dutch' },
    { code: 'en', label: 'English' },
    { code: 'fa', label: 'Farsi/Persian' },
    { code: 'fi', label: 'Finnish' },
    { code: 'fr', label: 'French' },
    { code: 'id', label: 'Indonesian' },
    { code: 'it', label: 'Italian' },
    { code: 'no', label: 'Norwegian' },
    { code: 'ro', label: 'Romanian' },
    { code: 'es', label: 'Spanish' },
    { code: 'sv', label: 'Swedish' },
    { code: 'vi', label: 'Vietnamese' },
    { code: 'sq', label: 'Albanian' },
    { code: 'az', label: 'Azerbaijani' },
    { code: 'be', label: 'Belarusian' },
    { code: 'bn', label: 'Bengali' },
    { code: 'zh_bg', label: 'Big 5 code (Chinese)' },
    { code: 'bs', label: 'Bosnian' },
    { code: 'bg', label: 'Bulgarian' },
    { code: 'bg_en', label: 'Bulgarian_English' },
    { code: 'my', label: 'Burmese' },
    { code: 'ca', label: 'Catalan' },
    { code: 'zh', label: 'Chinese BG code' },
    { code: 'hr', label: 'Croatian' },
    { code: 'cs', label: 'Czech' },
    { code: 'nl_en', label: 'Dutch_English' },
    { code: 'en_de', label: 'English_German' },
    { code: 'eo', label: 'Esperanto' },
    { code: 'et', label: 'Estonian' },
    { code: 'ka', label: 'Georgian' },
    { code: 'de', label: 'German' },
    { code: 'el', label: 'Greek' },
    { code: 'kl', label: 'Greenlandic' },
    { code: 'he', label: 'Hebrew' },
    { code: 'hi', label: 'Hindi' },
    { code: 'hu', label: 'Hungarian' },
    { code: 'hu_en', label: 'Hungarian_English' },
    { code: 'is', label: 'Icelandic' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'ku', label: 'Kurdish' },
    { code: 'lv', label: 'Latvian' },
    { code: 'lt', label: 'Lithuanian' },
    { code: 'mk', label: 'Macedonian' },
    { code: 'ms', label: 'Malay' },
    { code: 'ml', label: 'Malayalam' },
    { code: 'mni', label: 'Manipuri' },
    { code: 'pl', label: 'Polish' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'ru', label: 'Russian' },
    { code: 'sr', label: 'Serbian' },
    { code: 'si', label: 'Sinhala' },
    { code: 'sk', label: 'Slovak' },
    { code: 'sl', label: 'Slovenian' },
    { code: 'tl', label: 'Tagalog' },
    { code: 'ta', label: 'Tamil' },
    { code: 'te', label: 'Telugu' },
    { code: 'th', label: 'Thai' },
    { code: 'tr', label: 'Turkish' },
    { code: 'uk', label: 'Ukrainian' },
    { code: 'ur', label: 'Urdu' },
];

/** 'eng' → 'English'. Unknown codes pass through; 'und' means nothing useful. */
function languageName(code?: string): string | undefined {
    const c = (code || '').trim().toLowerCase();
    if (!c || c === 'und') {return undefined;}
    return LANGUAGES.find((l) => l.aliases.includes(c))?.name ?? code;
}

interface ExternalSubtitle {
    name: string;
    path?: string;
    cues: SubtitleCue[];
    isSDH: boolean;
    source: 'file' | 'api';
}

interface TrackSelectorProps {
    visible: boolean;
    onClose: () => void;
    /** Back arrow in the header, for returning to the Playback panel. */
    onBack?: () => void;
    tracks: any[];
    selectedTrackIndex: number | undefined | null;
    onSelectTrack: (trackIndex: number | null) => void;
    type: 'audio' | 'subtitle';
    onLoadExternalCues?: (cues: SubtitleCue[], name: string, isSDH: boolean) => void;
    onLoadSDHForHaptics?: (cues: SubtitleCue[], name: string) => void;
    apiSubtitles?: SubtitleResult[];
    externalSubtitles?: ExternalSubtitle[];
    currentExternalName?: string;
    videoName?: string;
    imdbId?: string;
    // Equalizer Props
    equalizerEnabled?: boolean;
    equalizerPreset?: string | null;
    equalizerBands?: number[];
    onToggleEqualizer?: () => void;
    onSelectPreset?: (presetId: string) => void;
    onSetEqualizerBand?: (index: number, value: number) => void;
    onResetEqualizer?: () => void;
    onOpenSyncPanel?: (type: 'audio' | 'subtitle') => void;
}

// ---------------------------------------------------------------------------

interface TrackRowProps {
    title: string;
    detail?: string;
    tags?: string[];
    selected?: boolean;
    disabled?: boolean;
    onPress: () => void;
    right?: React.ReactNode;
    accessibilityLabel?: string;
}

/** The selected track carries the accent check; the row itself stays neutral. */
const TrackRow = React.memo<TrackRowProps>(({ title, detail, tags, selected, disabled, onPress, right, accessibilityLabel }) => (
    <Touchable
        onPress={onPress}
        disabled={disabled}
        scaleTo={1}
        stateLayer
        onPlayer
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={{ selected: !!selected, disabled: !!disabled }}
        style={styles.row}
    >
        <View style={styles.rowBody}>
            <View style={styles.rowTitleLine}>
                <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
                {tags?.map((tag) => (
                    <View key={tag} style={styles.tag}>
                        <Text style={styles.tagText}>{tag}</Text>
                    </View>
                ))}
            </View>
            {!!detail && <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text>}
        </View>
        {right}
        {selected && <Feather name="check" size={20} color={colors.primary} />}
    </Touchable>
));

const EmptyState = React.memo<{ message: string }>(({ message }) => (
    <Text style={styles.emptyText}>{message}</Text>
));

const BandSlider = React.memo<{
    label: string;
    index: number;
    value: number;
    onChange: (index: number, val: number) => void;
    height: number;
    enabled: boolean;
}>(({ label, index, value, onChange, height, enabled }) => {
    const handleChange = useCallback((val: number) => onChange(index, val), [index, onChange]);
    return (
        <View style={styles.band}>
            <VerticalSlider
                min={-12}
                max={12}
                step={1}
                value={value}
                onValueChange={handleChange}
                height={height}
                thumbColor={colors.primary}
                activeTrackColor={colors.primary}
                trackColor={colors.fillStrong}
                disabled={!enabled}
            />
            <Text style={styles.bandValue}>{value > 0 ? '+' : ''}{value}</Text>
            <Text style={styles.bandLabel}>{label}</Text>
        </View>
    );
});

const noop = () => {};

// ---------------------------------------------------------------------------

export const TrackSelector: React.FC<TrackSelectorProps> = React.memo((props) => {
    const {
        visible,
        onClose,
        onBack,
        tracks,
        selectedTrackIndex,
        onSelectTrack,
        type,
        onLoadExternalCues,
        onLoadSDHForHaptics,
        apiSubtitles: initialApiSubtitles,
        externalSubtitles = [],
        currentExternalName,
        videoName = '',
        imdbId,
        onOpenSyncPanel,
    } = props;

    const { width, height } = useWindowDimensions();
    const isLandscape = width > height;

    // ---- Memoized Values ----
    const filteredTracks = useMemo(
        () => tracks.filter((t) => t.type === type),
        [tracks, type],
    );

    // Calculate default tab once and memoize
    const defaultTab = useMemo((): SubtitleTab => {
        if (type !== 'subtitle') {return 'embedded';}

        const embeddedTracks = tracks.filter((t) => t.type === 'subtitle');

        if (currentExternalName) {return 'external';}
        if (selectedTrackIndex !== null && embeddedTracks.length > 0) {return 'embedded';}
        if (embeddedTracks.length === 0 && externalSubtitles.length > 0) {return 'external';}
        if (embeddedTracks.length === 0 && initialApiSubtitles && initialApiSubtitles.length > 0)
            {return 'online';}

        return 'embedded';
    }, [type, currentExternalName, selectedTrackIndex, tracks, externalSubtitles, initialApiSubtitles]);

    // ---- State ----
    const [activeTab, setActiveTab] = useState<SubtitleTab>(defaultTab);
    const [audioTab, setAudioTab] = useState<AudioTab>('tracks');
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SubtitleResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    const [selectedLanguage, setSelectedLanguage] = useState('en');

    // Search options: an in-sheet sub-view of the Online tab
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [showSeasonEpisodeInputs, setShowSeasonEpisodeInputs] = useState(false);
    const [manualSeason, setManualSeason] = useState('');
    const [manualEpisode, setManualEpisode] = useState('');
    const [manualYear, setManualYear] = useState('');
    const [preferHI, setPreferHI] = useState(false);

    const searchTokenRef = useRef<number>(0);
    const abortControllerRef = useRef<AbortController | null>(null);
    const hasAutoSearchedRef = useRef(false);

    // ---- Effects ----
    useEffect(() => {
        // Cleanup any pending requests when the component unmounts
        return () => {
            abortControllerRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        if (visible) {
            setActiveTab(defaultTab);
            setAudioTab('tracks');
            setDownloadingId(null);
            hasAutoSearchedRef.current = false;
        } else {
            setSearchQuery('');
            setIsSearching(false);
            setDownloadingId(null);
            setOptionsOpen(false);
            // Abort any ongoing search when the modal closes
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;
        }
    }, [visible, defaultTab]);

    useEffect(() => {
        setOptionsOpen(false);
    }, [activeTab]);

    // Auto-fetch subtitles when Online tab opens
    useEffect(() => {
        if (
            visible &&
            activeTab === 'online' &&
            (videoName || imdbId) &&
            !hasAutoSearchedRef.current &&
            !isSearching
        ) {
            hasAutoSearchedRef.current = true;

            const autoSearch = async () => {
                try {
                    setIsSearching(true);
                    // Cancel previous
                    abortControllerRef.current?.abort();
                    abortControllerRef.current = new AbortController();

                    if (__DEV__) {console.log('[TrackSelector] autoSearch - videoName:', videoName, 'imdbId:', imdbId, 'language:', selectedLanguage, 'prioritizeSDH: false');}
                    const result = await searchAllSubtitles(videoName, selectedLanguage, imdbId, false, abortControllerRef.current.signal);
                    const subs = result.subtitles || [];
                    if (__DEV__) {console.log('[TrackSelector] autoSearch - received', subs.length, 'subtitles');}
                    setSearchResults(subs);
                } catch (error) {
                    if (isAbortError(error)) {
                        return;
                    }
                    console.error('[TrackSelector] Auto-search error:', error);
                } finally {
                    setIsSearching(false);
                }
            };

            autoSearch();
        }
    }, [visible, activeTab, videoName, imdbId, isSearching, selectedLanguage]);

    // Load initial API subtitles
    useEffect(() => {
        if (visible && initialApiSubtitles && initialApiSubtitles.length > 0 && !searchQuery.trim()) {
            setSearchResults(initialApiSubtitles);
        }
    }, [visible, initialApiSubtitles, searchQuery]);

    // Parse filename for defaults when videoName changes
    useEffect(() => {
        if (videoName) {
            const parsed = FilenameParser.parse(videoName);
            if (parsed.isTVShow) {
                setShowSeasonEpisodeInputs(true);
                if (parsed.season) {setManualSeason(parsed.season.toString().padStart(2, '0'));}
                if (parsed.episode) {setManualEpisode(parsed.episode.toString().padStart(2, '0'));}
            } else {
                setShowSeasonEpisodeInputs(false);
                setManualSeason('');
                setManualEpisode('');
            }
            if (!searchQuery && parsed.title) {
                setSearchQuery(parsed.title);
            }
            if (parsed.year) {
                setManualYear(parsed.year.toString());
            }
        }
    }, [videoName]);

    // ---- Handlers ----
    const handleTurnOffSubtitles = useCallback(() => {
        onSelectTrack(null);
        onClose();
    }, [onSelectTrack, onClose]);

    const handlePickFile = useCallback(async () => {
        if (!onLoadExternalCues) {return;}

        try {
            setLoading(true);
            const result = await SubtitlePickerService.pickFromStorage();

            if (result) {
                const validation = SubtitleSelectionService.validateSDHContent(result.cues);
                onLoadExternalCues(result.cues, result.name, validation.isSDH);

                if (validation.isSDH && onLoadSDHForHaptics) {
                    onLoadSDHForHaptics(result.cues, result.name);
                }

                onClose();
            }
        } catch (error) {
            console.error('[TrackSelector] File pick error:', error);
        } finally {
            setLoading(false);
        }
    }, [onLoadExternalCues, onLoadSDHForHaptics, onClose]);

    const handleSearch = useCallback(async () => {
        const query = searchQuery.trim();
        if (!query) {return;}

        const token = Date.now();
        searchTokenRef.current = token;

        try {
            setIsSearching(true);
            const s = manualSeason ? parseInt(manualSeason, 10) : undefined;
            const e = manualEpisode ? parseInt(manualEpisode, 10) : undefined;
            const y = manualYear ? parseInt(manualYear, 10) : undefined;

            if (__DEV__) {console.log('[TrackSelector] handleSearch - query:', query, 'language:', selectedLanguage, 'prioritizeSDH:', preferHI, 'S:', s, 'E:', e, 'Y:', y);}

            // Cancel previous
            abortControllerRef.current?.abort();
            abortControllerRef.current = new AbortController();

            const result = await searchAllSubtitles(
                query,
                selectedLanguage,
                undefined,
                preferHI,
                abortControllerRef.current.signal,
                s,
                e,
                y
            );

            if (searchTokenRef.current !== token) {return;}

            if (__DEV__) {console.log('[TrackSelector] handleSearch - received', result.subtitles?.length || 0, 'subtitles');}
            setSearchResults(result.subtitles || []);
        } catch (error) {
            if (isAbortError(error)) {
                return;
            }
            console.error('[TrackSelector] Search error:', error);
            if (searchTokenRef.current !== token) {return;}
            setSearchResults([]);
        } finally {
            if (searchTokenRef.current === token) {
                setIsSearching(false);
            }
        }
    }, [searchQuery, selectedLanguage, manualSeason, manualEpisode, manualYear, preferHI]);

    const handleDownloadSubtitle = useCallback(
        async (subtitle: SubtitleResult) => {
            if (!onLoadExternalCues) {return;}

            const currentId = subtitle.id;
            try {
                setDownloadingId(currentId);
                abortControllerRef.current?.abort();
                abortControllerRef.current = new AbortController();
                const content = await downloadSubtitle(subtitle.downloadUrl, abortControllerRef.current.signal);

                if (!content) {return;}

                const cues = SubtitleParser.parse(content, 'srt');
                if (cues.length === 0) {return;}

                const validation = SubtitleSelectionService.validateSDHContent(cues);
                const name = subtitle.release || subtitle.name || 'Downloaded Subtitle';

                onLoadExternalCues(cues, name, validation.isSDH);

                if (validation.isSDH && onLoadSDHForHaptics) {
                    onLoadSDHForHaptics(cues, name);
                }

                onClose();
            } catch (error) {
                if (isAbortError(error)) {
                    return;
                }
                console.error('[TrackSelector] Download error:', error);
            } finally {
                setDownloadingId((prev) => (prev === currentId ? null : prev));
            }
        },
        [onLoadExternalCues, onLoadSDHForHaptics, onClose],
    );

    const handleLanguageChange = useCallback((langCode: string) => {
        setSelectedLanguage(langCode);
        hasAutoSearchedRef.current = false; // Reset to trigger new search
    }, []);

    const handleOptionsSearch = useCallback(() => {
        setOptionsOpen(false);
        handleSearch();
    }, [handleSearch]);

    // ---- Render Item Functions ----
    const renderTrackItem: ListRenderItem<any> = useCallback(
        ({ item, index }) => {
            const language = languageName(item.language);
            const title = item.title || language || `Track ${index + 1}`;
            return (
                <TrackRow
                    title={title}
                    detail={language && language.toLowerCase() !== title.toLowerCase() ? language : undefined}
                    tags={item.isDefault ? ['Default'] : undefined}
                    selected={selectedTrackIndex === item.index}
                    onPress={() => {
                        onSelectTrack(item.index);
                        onClose();
                    }}
                />
            );
        },
        [selectedTrackIndex, onSelectTrack, onClose],
    );

    const renderExternalItem: ListRenderItem<ExternalSubtitle> = useCallback(
        ({ item }) => (
            <TrackRow
                title={item.name}
                detail={item.source === 'api' ? 'Downloaded' : 'From your device'}
                tags={item.isSDH ? ['SDH'] : undefined}
                selected={currentExternalName === item.name}
                onPress={() => {
                    if (!onLoadExternalCues) {return;}

                    onLoadExternalCues(item.cues, item.name, item.isSDH);
                    if (item.isSDH && onLoadSDHForHaptics) {
                        onLoadSDHForHaptics(item.cues, item.name);
                    }
                    onClose();
                }}
            />
        ),
        [currentExternalName, onLoadExternalCues, onLoadSDHForHaptics, onClose],
    );

    const renderOnlineItem: ListRenderItem<SubtitleResult> = useCallback(
        ({ item }) => {
            const isSDH = (item.sdhScore || 0) > 5 || item.hearingImpaired;
            const isDownloading = downloadingId === item.id;
            const title = item.release || item.name;
            return (
                <TrackRow
                    title={title}
                    tags={isSDH ? ['SDH'] : undefined}
                    disabled={isDownloading}
                    onPress={() => handleDownloadSubtitle(item)}
                    accessibilityLabel={`Download ${title}`}
                    right={isDownloading
                        ? <ActivityIndicator size="small" color={colors.text} />
                        : <Feather name="download" size={16} color={colors.textTertiary} />}
                />
            );
        },
        [downloadingId, handleDownloadSubtitle],
    );

    // ---- Pieces ----
    const offRow = type === 'subtitle' ? (
        <TrackRow
            title="Off"
            selected={selectedTrackIndex === null && !currentExternalName}
            onPress={handleTurnOffSubtitles}
        />
    ) : null;

    const externalHeader = (
        <>
            {offRow}
            <Button
                label="Browse files"
                onPress={handlePickFile}
                loading={loading}
                onPlayer
                style={styles.listButton}
            />
        </>
    );

    const onlineHeader = (
        <>
            {offRow}
            <View style={styles.searchRow}>
                <View style={[styles.input, styles.searchInput]}>
                    <TextInput
                        style={styles.inputText}
                        placeholder="Movie or series name"
                        placeholderTextColor={colors.textTertiary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        onSubmitEditing={handleSearch}
                        returnKeyType="search"
                        autoCapitalize="none"
                        autoCorrect={false}
                        selectionColor={colors.primary}
                    />
                    {searchQuery.length > 0 && (
                        <IconButton icon="x" iconSize={15} color={colors.textTertiary} onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" onPlayer />
                    )}
                </View>
                {isSearching ? (
                    <View style={styles.searchSpinner}><ActivityIndicator size="small" color={colors.text} /></View>
                ) : (
                    <IconButton icon="search" variant="filled" onPress={handleSearch} disabled={!searchQuery.trim()} accessibilityLabel="Search" onPlayer />
                )}
                <IconButton icon="sliders" variant="filled" onPress={() => setOptionsOpen(true)} accessibilityLabel="Search options" onPlayer />
            </View>
        </>
    );

    const tabs: { id: string; label: string }[] = type === 'audio'
        ? [{ id: 'tracks', label: 'Tracks' }, { id: 'effects', label: 'Effects' }]
        : [{ id: 'embedded', label: 'Built-in' }, { id: 'external', label: 'Files' }, { id: 'online', label: 'Online' }];
    const currentTab = type === 'audio' ? audioTab : activeTab;

    const canSync = (selectedTrackIndex !== null && selectedTrackIndex !== undefined) || !!currentExternalName;

    const tabBar = (
        <View style={styles.tabBar}>
            {tabs.map((t) => (
                <Chip
                    key={t.id}
                    label={t.label}
                    selected={currentTab === t.id}
                    onPress={() => (type === 'audio' ? setAudioTab(t.id as AudioTab) : setActiveTab(t.id as SubtitleTab))}
                    onPlayer
                    style={styles.tab}
                />
            ))}
            {canSync && (
                <Chip
                    label="Sync"
                    icon="clock"
                    onPress={() => {
                        onOpenSyncPanel?.(type);
                        onClose();
                    }}
                    accessibilityLabel={type === 'audio' ? 'Adjust audio sync' : 'Adjust subtitle sync'}
                    onPlayer
                    style={styles.tab}
                />
            )}
        </View>
    );

    const renderEffects = () => {
        const enabled = !!props.equalizerEnabled;
        const preset = EQUALIZER_PRESETS.find((p) => p.id === props.equalizerPreset);
        const presetName = props.equalizerPreset === 'custom' ? 'Custom' : (preset ? preset.name : 'Flat');
        const bands = props.equalizerPreset === 'custom' || !preset ? (props.equalizerBands ?? []) : preset.values;
        return (
            <ScrollView contentContainerStyle={styles.pad} showsVerticalScrollIndicator={false}>
                <ListGroup inset onPlayer>
                    <ListRow
                        title="Equalizer"
                        caption={enabled ? presetName : 'Off'}
                        toggle={{ value: enabled, onChange: () => props.onToggleEqualizer?.() }}
                        onPlayer
                    />
                </ListGroup>

                <View style={styles.chipWrap}>
                    {EQUALIZER_PRESETS.map((p) => (
                        <Chip
                            key={p.id}
                            label={p.name}
                            selected={enabled && props.equalizerPreset === p.id}
                            onPress={() => props.onSelectPreset?.(p.id)}
                            onPlayer
                        />
                    ))}
                </View>

                <View style={[styles.bandsBox, !enabled && styles.dimmed]}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bands} nestedScrollEnabled>
                        {EQUALIZER_BANDS.map((band, i) => (
                            <BandSlider
                                key={band.freq}
                                label={band.label}
                                index={i}
                                value={bands[i] || 0}
                                onChange={props.onSetEqualizerBand ?? noop}
                                height={isLandscape ? 120 : 170}
                                enabled={enabled}
                            />
                        ))}
                    </ScrollView>
                </View>

                <Button
                    label="Reset"
                    onPress={props.onResetEqualizer ?? noop}
                    disabled={!enabled}
                    onPlayer
                    style={styles.resetButton}
                />
            </ScrollView>
        );
    };

    const renderSearchOptions = () => (
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>Name</Text>
            <View style={styles.input}>
                <TextInput
                    style={styles.inputText}
                    placeholder="Movie or series name"
                    placeholderTextColor={colors.textTertiary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    returnKeyType="search"
                    onSubmitEditing={handleOptionsSearch}
                    autoCapitalize="none"
                    autoCorrect={false}
                    selectionColor={colors.primary}
                />
                {searchQuery.length > 0 && (
                    <IconButton icon="x" iconSize={15} color={colors.textTertiary} onPress={() => setSearchQuery('')} accessibilityLabel="Clear name" onPlayer />
                )}
            </View>

            <Text style={styles.label}>Year</Text>
            <TextInput
                style={[styles.input, styles.inputText]}
                placeholder="Any"
                placeholderTextColor={colors.textTertiary}
                value={manualYear}
                onChangeText={setManualYear}
                keyboardType="numeric"
                maxLength={4}
                selectionColor={colors.primary}
            />

            <ListGroup inset onPlayer style={styles.groupGap}>
                <ListRow
                    title="TV show"
                    toggle={{ value: showSeasonEpisodeInputs, onChange: setShowSeasonEpisodeInputs }}
                    onPlayer
                />
                <ListRow
                    title="Prefer SDH"
                    caption="Subtitles for the deaf and hard of hearing"
                    toggle={{ value: preferHI, onChange: setPreferHI }}
                    onPlayer
                />
            </ListGroup>

            {showSeasonEpisodeInputs && (
                <View style={styles.pairRow}>
                    <View style={styles.rowBody}>
                        <Text style={styles.label}>Season</Text>
                        <TextInput
                            style={[styles.input, styles.inputText]}
                            placeholder="01"
                            placeholderTextColor={colors.textTertiary}
                            value={manualSeason}
                            onChangeText={setManualSeason}
                            keyboardType="numeric"
                            maxLength={3}
                            selectionColor={colors.primary}
                        />
                    </View>
                    <View style={styles.rowBody}>
                        <Text style={styles.label}>Episode</Text>
                        <TextInput
                            style={[styles.input, styles.inputText]}
                            placeholder="01"
                            placeholderTextColor={colors.textTertiary}
                            value={manualEpisode}
                            onChangeText={setManualEpisode}
                            keyboardType="numeric"
                            maxLength={3}
                            selectionColor={colors.primary}
                        />
                    </View>
                </View>
            )}

            <Text style={styles.label}>Language</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll}>
                {SUBTITLE_LANGUAGES.map((lang) => (
                    <Chip
                        key={lang.code}
                        label={lang.label}
                        selected={selectedLanguage === lang.code}
                        onPress={() => handleLanguageChange(lang.code)}
                        onPlayer
                    />
                ))}
            </ScrollView>

            <Button
                label="Search"
                variant="primary"
                size="lg"
                onPress={handleOptionsSearch}
                disabled={!searchQuery.trim()}
                onPlayer
                style={styles.searchButton}
            />
        </ScrollView>
    );

    const renderContent = () => {
        if (type === 'audio') {
            if (audioTab === 'effects') {return renderEffects();}
            return (
                <FlashList
                    data={filteredTracks}
                    renderItem={renderTrackItem}
                    keyExtractor={(item, index) => item.index?.toString() ?? `audio-${index}`}
                    contentContainerStyle={styles.list}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={<EmptyState message="No audio tracks" />}
                />
            );
        }

        switch (activeTab) {
            case 'embedded':
                return (
                    <FlashList
                        data={filteredTracks}
                        renderItem={renderTrackItem}
                        keyExtractor={(item, index) => item.index?.toString() ?? `sub-${index}`}
                        ListHeaderComponent={offRow}
                        contentContainerStyle={styles.list}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={<EmptyState message="This video has no built-in subtitles" />}
                    />
                );

            case 'external':
                return (
                    <FlashList
                        data={externalSubtitles}
                        renderItem={renderExternalItem}
                        keyExtractor={(item, index) => `${item.name}-${index}`}
                        ListHeaderComponent={externalHeader}
                        contentContainerStyle={styles.list}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={<EmptyState message="No subtitle files loaded yet" />}
                    />
                );

            case 'online':
                if (optionsOpen) {return renderSearchOptions();}
                return (
                    <FlashList
                        data={searchResults}
                        renderItem={renderOnlineItem}
                        keyExtractor={(item, index) => item.id ?? `online-${index}`}
                        ListHeaderComponent={onlineHeader}
                        contentContainerStyle={styles.list}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={
                            <EmptyState message={searchQuery.trim() ? 'No results. Try a different name.' : 'Search by movie or series name'} />
                        }
                    />
                );

            default:
                return null;
        }
    };

    const inOptions = type === 'subtitle' && activeTab === 'online' && optionsOpen;

    // ---- Render ----
    return (
        <SidePanel
            visible={visible}
            title={inOptions ? 'Search options' : type === 'audio' ? 'Audio' : 'Subtitles'}
            onClose={onClose}
            onBack={inOptions ? () => setOptionsOpen(false) : onBack}
        >
            {!inOptions && tabBar}

            <View style={styles.content}>{renderContent()}</View>
        </SidePanel>
    );
});

const styles = StyleSheet.create({
    tabBar: {
        flexDirection: 'row',
        gap: metrics.space.sm,
        paddingTop: metrics.space.xs,
        paddingBottom: metrics.space.sm,
    },
    tab: { flex: 1 },
    content: { flex: 1 },
    list: { paddingBottom: metrics.space.lg },
    pad: { paddingTop: metrics.space.sm, paddingBottom: metrics.space.xl },

    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
        minHeight: 56,
        paddingHorizontal: metrics.space.xs,
        paddingVertical: metrics.space.sm,
        borderRadius: metrics.radius.md,
    },
    rowBody: { flex: 1, gap: 2 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: metrics.space.sm },
    rowTitle: { ...typo.row, color: colors.text, flexShrink: 1 },
    rowDetail: { ...typo.caption, color: colors.textSecondary },
    tag: {
        backgroundColor: colors.fill,
        borderRadius: metrics.radius.xs,
        paddingHorizontal: 6,
        paddingVertical: 1,
    },
    tagText: { ...typo.caption, fontSize: 10.5, color: colors.textSecondary },

    emptyText: {
        ...typo.body,
        color: colors.textSecondary,
        textAlign: 'center',
        paddingVertical: metrics.space.xxl,
        paddingHorizontal: metrics.space.xl,
    },
    listButton: { marginVertical: metrics.space.sm },

    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.sm,
        marginTop: metrics.space.sm,
        marginBottom: metrics.space.sm,
    },
    searchInput: { flex: 1 },
    searchSpinner: { width: metrics.touch - 8, alignItems: 'center' },
    input: {
        flexDirection: 'row',
        alignItems: 'center',
        height: metrics.touch,
        paddingLeft: 14,
        paddingRight: 4,
        borderRadius: metrics.radius.pill,
        backgroundColor: colors.fill,
    },
    inputText: { flex: 1, ...typo.body, color: colors.text, paddingVertical: 0 },
    label: {
        ...typo.label,
        color: colors.primary,
        marginTop: metrics.space.lg,
        marginBottom: metrics.space.sm,
    },
    groupGap: { marginTop: metrics.space.lg },
    pairRow: { flexDirection: 'row', gap: metrics.space.md },
    chipScroll: { marginHorizontal: -metrics.gutter },
    chipRow: { gap: metrics.space.sm, paddingHorizontal: metrics.gutter, paddingVertical: 4 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: metrics.space.sm, marginTop: metrics.space.md },
    searchButton: { marginTop: metrics.space.xl },

    bandsBox: {
        marginTop: metrics.space.lg,
        borderRadius: metrics.radius.lg,
        backgroundColor: colors.fill,
    },
    dimmed: { opacity: 0.4 },
    bands: { paddingHorizontal: metrics.space.sm, paddingVertical: metrics.space.md },
    band: { width: 48, alignItems: 'center', gap: 4 },
    bandValue: { ...typo.caption, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: 6 },
    bandLabel: { ...typo.caption, color: colors.textTertiary },
    resetButton: { marginTop: metrics.space.md, alignSelf: 'flex-start' },
});
