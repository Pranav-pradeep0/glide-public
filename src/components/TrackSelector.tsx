import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
    ActivityIndicator,
    TextInput,
    Switch,
    ScrollView,
    TouchableOpacity,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import type { ListRenderItem } from '@shopify/flash-list';
import Feather from '@react-native-vector-icons/feather';
import { SubtitleIcon, AudioIcon } from './VideoPlayer/PlayerIcons';
import { SubtitlePickerService } from '../services/SubtitlePickerService';
import { SubtitleResult, SubtitleCue } from '../types';
import { searchAllSubtitles, downloadSubtitle } from '../utils/subdlApi';
import { SubtitleParser } from '../utils/SubtitleParser';
import { SubtitleSelectionService } from '../services/SubtitleSelectionService';
import { EQUALIZER_PRESETS } from '../config/equalizerPresets';

type SubtitleTab = 'embedded' | 'external' | 'online';
type AudioTab = 'tracks' | 'effects';

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
    onToggleEqualizer?: () => void;
    onOpenEqualizerModal?: () => void;
    onSelectPreset?: (presetId: string) => void;
    onOpenSyncPanel?: (type: 'audio' | 'subtitle') => void;
}

// Memoized empty state component
const EmptyState = React.memo<{ message: string; iconName: string }>(
    ({ message, iconName }) => (
        <View style={styles.emptyContainer}>
            <Feather name={iconName as any} size={48} color="#333333" style={styles.emptyIcon} />
            <Text style={styles.emptyText}>{message}</Text>
        </View>
    ),
);

export const TrackSelector: React.FC<TrackSelectorProps> = React.memo((props) => {
    const {
        visible,
        onClose,
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

    // ---- Memoized Values ----
    const filteredTracks = useMemo(
        () => tracks.filter((t) => t.type === type),
        [tracks, type],
    );

    const title = type === 'audio' ? 'Audio Tracks' : 'Subtitles';
    const IconComponent = type === 'audio' ? AudioIcon : SubtitleIcon;

    // Calculate default tab once and memoize
    const defaultTab = useMemo((): SubtitleTab => {
        if (type !== 'subtitle') return 'embedded';

        const embeddedTracks = tracks.filter((t) => t.type === 'subtitle');

        if (currentExternalName) return 'external';
        if (selectedTrackIndex !== null && embeddedTracks.length > 0) return 'embedded';
        if (embeddedTracks.length === 0 && externalSubtitles.length > 0) return 'external';
        if (embeddedTracks.length === 0 && initialApiSubtitles && initialApiSubtitles.length > 0)
            return 'online';

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
    const [showSearchBar, setShowSearchBar] = useState(true);

    const searchTokenRef = useRef<number>(0);
    const hasAutoSearchedRef = useRef(false);

    // ---- Effects ----
    useEffect(() => {
        if (visible) {
            setActiveTab(defaultTab);
            setAudioTab('tracks');
            setDownloadingId(null);
            setShowSearchBar(true);
            hasAutoSearchedRef.current = false;
        } else {
            setSearchQuery('');
            setIsSearching(false);
            setDownloadingId(null);
        }
    }, [visible, defaultTab]);

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
                    const result = await searchAllSubtitles(videoName, 'en', imdbId);
                    const subs = result.subtitles || [];
                    setSearchResults(subs);

                    if (subs.length > 0) {
                        setShowSearchBar(false);
                    }
                } catch (error) {
                    console.error('[TrackSelector] Auto-search error:', error);
                } finally {
                    setIsSearching(false);
                }
            };

            autoSearch();
        }
    }, [visible, activeTab, videoName, imdbId, isSearching]);

    // Load initial API subtitles
    useEffect(() => {
        if (visible && initialApiSubtitles && initialApiSubtitles.length > 0 && !searchQuery.trim()) {
            setSearchResults(initialApiSubtitles);
        }
    }, [visible, initialApiSubtitles, searchQuery]);

    // ---- Handlers ----
    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    const handleTurnOffSubtitles = useCallback(() => {
        onSelectTrack(null);
        onClose();
    }, [onSelectTrack, onClose]);

    const handlePickFile = useCallback(async () => {
        if (!onLoadExternalCues) return;

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
        if (!query) return;

        const token = Date.now();
        searchTokenRef.current = token;

        try {
            setIsSearching(true);
            const result = await searchAllSubtitles(query);
            if (searchTokenRef.current !== token) return;

            setSearchResults(result.subtitles || []);
        } catch (error) {
            console.error('[TrackSelector] Search error:', error);
            if (searchTokenRef.current !== token) return;
            setSearchResults([]);
        } finally {
            if (searchTokenRef.current === token) {
                setIsSearching(false);
            }
        }
    }, [searchQuery]);

    const handleDownloadSubtitle = useCallback(
        async (subtitle: SubtitleResult) => {
            if (!onLoadExternalCues) return;

            const currentId = subtitle.id;
            try {
                setDownloadingId(currentId);
                const content = await downloadSubtitle(subtitle.downloadUrl);

                if (!content) return;

                const cues = SubtitleParser.parse(content, 'srt');
                if (cues.length === 0) return;

                const validation = SubtitleSelectionService.validateSDHContent(cues);
                const name = subtitle.release || subtitle.name || 'Downloaded Subtitle';

                onLoadExternalCues(cues, name, validation.isSDH);

                if (validation.isSDH && onLoadSDHForHaptics) {
                    onLoadSDHForHaptics(cues, name);
                }

                onClose();
            } catch (error) {
                console.error('[TrackSelector] Download error:', error);
            } finally {
                setDownloadingId((prev) => (prev === currentId ? null : prev));
            }
        },
        [onLoadExternalCues, onLoadSDHForHaptics, onClose],
    );

    // ---- Render Item Functions ----
    const renderTrackItem: ListRenderItem<any> = useCallback(
        ({ item, index }) => {
            const isSelected = selectedTrackIndex === item.index;

            return (
                <Pressable
                    style={({ pressed }) => [
                        styles.trackItem,
                        isSelected && styles.trackItemSelected,
                        pressed && styles.trackItemPressed,
                    ]}
                    onPress={() => {
                        onSelectTrack(item.index);
                        onClose();
                    }}
                >
                    <View style={styles.trackMain}>
                        <View style={styles.trackLeft}>
                            <View
                                style={[
                                    styles.trackIconBadge,
                                    isSelected && styles.trackIconBadgeActive,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.trackNumber,
                                        isSelected && styles.trackNumberActive,
                                    ]}
                                >
                                    {index + 1}
                                </Text>
                            </View>
                            <View style={styles.trackInfo}>
                                <Text
                                    style={[
                                        styles.trackTitle,
                                        isSelected && styles.trackTitleActive,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {item.title || `${type} ${item.index}`}
                                </Text>
                                <Text style={styles.trackSubtitle} numberOfLines={1}>
                                    {item.language} • {item.codec}
                                    {item.isDefault ? ' • Default' : ''}
                                </Text>
                            </View>
                        </View>
                        {isSelected && (
                            <View style={styles.checkBadge}>
                                <Feather name="check" size={16} color="#CCCCCC" />
                            </View>
                        )}
                    </View>
                </Pressable>
            );
        },
        [selectedTrackIndex, onSelectTrack, onClose, type],
    );

    const renderExternalItem: ListRenderItem<ExternalSubtitle> = useCallback(
        ({ item }) => {
            const isSelected = currentExternalName === item.name;

            return (
                <Pressable
                    style={({ pressed }) => [
                        styles.trackItem,
                        isSelected && styles.trackItemSelected,
                        pressed && styles.trackItemPressed,
                    ]}
                    onPress={() => {
                        if (!onLoadExternalCues) return;

                        onLoadExternalCues(item.cues, item.name, item.isSDH);
                        if (item.isSDH && onLoadSDHForHaptics) {
                            onLoadSDHForHaptics(item.cues, item.name);
                        }
                        onClose();
                    }}
                >
                    <View style={styles.trackMain}>
                        <View style={styles.trackLeft}>
                            <View
                                style={[
                                    styles.trackIconBadge,
                                    isSelected && styles.trackIconBadgeActive,
                                    item.isSDH && styles.trackIconBadgeSDH,
                                ]}
                            >
                                <Feather
                                    name={item.source === 'api' ? 'download-cloud' : 'file-text'}
                                    size={16}
                                    color={
                                        item.isSDH
                                            ? '#4CAF50'
                                            : isSelected
                                                ? '#CCCCCC'
                                                : '#666666'
                                    }
                                />
                            </View>
                            <View style={styles.trackInfo}>
                                <Text
                                    style={[
                                        styles.trackTitle,
                                        isSelected && styles.trackTitleActive,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {item.name}
                                </Text>
                                <Text style={styles.trackSubtitle} numberOfLines={1}>
                                    {item.cues.length} cues •{' '}
                                    {item.source === 'api' ? 'Downloaded' : 'Local file'}
                                    {item.isSDH ? ' • SDH' : ''}
                                </Text>
                            </View>
                        </View>
                        {isSelected && (
                            <View style={styles.checkBadge}>
                                <Feather name="check" size={16} color="#CCCCCC" />
                            </View>
                        )}
                    </View>
                </Pressable>
            );
        },
        [currentExternalName, onLoadExternalCues, onLoadSDHForHaptics, onClose],
    );

    const renderOnlineItem: ListRenderItem<SubtitleResult> = useCallback(
        ({ item }) => {
            const isSDH = (item.sdhScore || 0) > 5 || item.hearingImpaired;
            const isDownloading = downloadingId === item.id;

            return (
                <Pressable
                    style={({ pressed }) => [
                        styles.trackItem,
                        pressed && styles.trackItemPressed,
                    ]}
                    onPress={() => handleDownloadSubtitle(item)}
                    disabled={isDownloading}
                >
                    <View style={styles.trackMain}>
                        <View style={styles.trackLeft}>
                            <View
                                style={[
                                    styles.trackIconBadge,
                                    isSDH && styles.trackIconBadgeSDH,
                                ]}
                            >
                                <Feather
                                    name={isSDH ? 'headphones' : 'type'}
                                    size={16}
                                    color={isSDH ? '#4CAF50' : '#666666'}
                                />
                            </View>
                            <View style={styles.trackInfo}>
                                <Text style={styles.trackTitle} numberOfLines={1}>
                                    {item.release || item.name}
                                </Text>
                                <Text style={styles.trackSubtitle} numberOfLines={1}>
                                    {item.language} • {item.author}
                                    {isSDH ? ' • SDH' : ''}
                                </Text>
                            </View>
                        </View>
                        {isDownloading ? (
                            <ActivityIndicator size="small" color="#CCCCCC" />
                        ) : (
                            <Feather name="download" size={18} color="#666666" />
                        )}
                    </View>
                </Pressable>
            );
        },
        [downloadingId, handleDownloadSubtitle],
    );

    // ---- Memoized Components ----
    const OffOption = useMemo(() => {
        if (type !== 'subtitle') return null;

        const isOffSelected = selectedTrackIndex === null && !currentExternalName;

        return (
            <Pressable
                style={({ pressed }) => [
                    styles.trackItem,
                    isOffSelected && styles.trackItemSelected,
                    pressed && styles.trackItemPressed,
                ]}
                onPress={handleTurnOffSubtitles}
            >
                <View style={styles.trackMain}>
                    <View style={styles.trackLeft}>
                        <View
                            style={[
                                styles.trackIconBadge,
                                isOffSelected && styles.trackIconBadgeActive,
                            ]}
                        >
                            <Feather
                                name="slash"
                                size={16}
                                color={isOffSelected ? '#CCCCCC' : '#666666'}
                            />
                        </View>
                        <View style={styles.trackInfo}>
                            <Text
                                style={[
                                    styles.trackTitle,
                                    isOffSelected && styles.trackTitleActive,
                                ]}
                            >
                                None
                            </Text>
                            <Text style={styles.trackSubtitle}>No subtitles</Text>
                        </View>
                    </View>
                    {isOffSelected && (
                        <View style={styles.checkBadge}>
                            <Feather name="check" size={16} color="#CCCCCC" />
                        </View>
                    )}
                </View>
            </Pressable>
        );
    }, [type, selectedTrackIndex, currentExternalName, handleTurnOffSubtitles]);

    const ExternalHeader = useMemo(
        () => (
            <>
                {OffOption}
                <Pressable
                    style={({ pressed }) => [
                        styles.browseButton,
                        pressed && styles.browseButtonPressed,
                    ]}
                    onPress={handlePickFile}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#CCCCCC" />
                    ) : (
                        <>
                            <Feather name="folder-plus" size={20} color="#CCCCCC" />
                            <Text style={styles.browseButtonText}>Browse Device Storage</Text>
                        </>
                    )}
                </Pressable>
            </>
        ),
        [OffOption, handlePickFile, loading],
    );

    const OnlineHeader = useMemo(
        () => (
            <>
                {OffOption}
                {showSearchBar && (
                    <View style={styles.searchContainer}>
                        <View style={styles.searchInputWrapper}>
                            <Feather
                                name="search"
                                size={18}
                                color="#666666"
                                style={styles.searchIcon}
                            />
                            <TextInput
                                style={styles.searchInput}
                                placeholder="Search movie or series name..."
                                placeholderTextColor="#666666"
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                onSubmitEditing={handleSearch}
                                returnKeyType="search"
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            {searchQuery.length > 0 && (
                                <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                                    <Feather name="x" size={18} color="#666666" />
                                </Pressable>
                            )}
                        </View>
                        <Pressable
                            style={[
                                styles.searchButton,
                                (isSearching || !searchQuery.trim()) && styles.searchButtonDisabled,
                            ]}
                            onPress={handleSearch}
                            disabled={isSearching || !searchQuery.trim()}
                        >
                            {isSearching ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                                <Text style={styles.searchButtonText}>Search</Text>
                            )}
                        </Pressable>
                    </View>
                )}
            </>
        ),
        [OffOption, showSearchBar, searchQuery, handleSearch, isSearching],
    );

    const TabBar = useMemo(() => {
        if (type === 'audio') {
            return (
                <View style={styles.tabBar}>
                    <Pressable
                        style={[styles.tab, audioTab === 'tracks' && styles.tabActive]}
                        onPress={() => setAudioTab('tracks')}
                    >
                        <Feather
                            name="music"
                            size={16}
                            color={audioTab === 'tracks' ? '#FFFFFF' : '#666666'}
                        />
                        <Text
                            style={[
                                styles.tabText,
                                audioTab === 'tracks' && styles.tabTextActive,
                            ]}
                        >
                            Tracks
                        </Text>
                    </Pressable>
                    <Pressable
                        style={[styles.tab, audioTab === 'effects' && styles.tabActive]}
                        onPress={() => setAudioTab('effects')}
                    >
                        <Feather
                            name="sliders"
                            size={16}
                            color={audioTab === 'effects' ? '#FFFFFF' : '#666666'}
                        />
                        <Text
                            style={[
                                styles.tabText,
                                audioTab === 'effects' && styles.tabTextActive,
                            ]}
                        >
                            Effects
                        </Text>
                    </Pressable>
                </View>
            );
        }

        if (type !== 'subtitle') return null;

        return (
            <View style={styles.tabBar}>
                <Pressable
                    style={[styles.tab, activeTab === 'embedded' && styles.tabActive]}
                    onPress={() => setActiveTab('embedded')}
                >
                    <Feather
                        name="film"
                        size={16}
                        color={activeTab === 'embedded' ? '#FFFFFF' : '#666666'}
                    />
                    <Text
                        style={[styles.tabText, activeTab === 'embedded' && styles.tabTextActive]}
                    >
                        Embedded
                    </Text>
                </Pressable>
                <Pressable
                    style={[styles.tab, activeTab === 'external' && styles.tabActive]}
                    onPress={() => setActiveTab('external')}
                >
                    <Feather
                        name="folder"
                        size={16}
                        color={activeTab === 'external' ? '#FFFFFF' : '#666666'}
                    />
                    <Text
                        style={[styles.tabText, activeTab === 'external' && styles.tabTextActive]}
                    >
                        External
                    </Text>
                </Pressable>
                <Pressable
                    style={[styles.tab, activeTab === 'online' && styles.tabActive]}
                    onPress={() => setActiveTab('online')}
                >
                    <Feather
                        name="search"
                        size={16}
                        color={activeTab === 'online' ? '#FFFFFF' : '#666666'}
                    />
                    <Text style={[styles.tabText, activeTab === 'online' && styles.tabTextActive]}>
                        Online
                    </Text>
                </Pressable>
            </View>
        );
    }, [type, activeTab, audioTab]);

    // Empty components memoized
    const EmbeddedEmpty = useMemo(
        () => <EmptyState message="No embedded subtitles found" iconName="film" />,
        [],
    );

    const ExternalEmpty = useMemo(
        () => (
            <EmptyState
                message="No external subtitles loaded yet.\nUse the button above to browse files."
                iconName="folder"
            />
        ),
        [],
    );

    const OnlineEmpty = useMemo(
        () => (
            <EmptyState
                message={
                    searchQuery.trim()
                        ? 'No results found. Try a different search.'
                        : 'Search for subtitles by movie or series name.'
                }
                iconName="search"
            />
        ),
        [searchQuery],
    );

    // ---- Render Content ----
    const renderContent = useCallback(() => {
        if (type === 'audio') {
            if (audioTab === 'effects') {
                const activePreset = EQUALIZER_PRESETS.find(p => p.id === props.equalizerPreset);
                const presetName = props.equalizerPreset === 'custom'
                    ? 'Custom'
                    : (activePreset ? activePreset.name : 'Flat');

                return (
                    <ScrollView
                        style={styles.effectsContainer}
                        contentContainerStyle={styles.effectsContent}
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.effectItem}>
                            <View style={styles.effectInfo}>
                                <Text style={styles.effectTitle}>Audio Equalizer</Text>
                                <Text style={styles.effectSubtitle}>
                                    {props.equalizerEnabled ? 'On' : 'Off'} • {presetName}
                                </Text>
                            </View>

                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                <TouchableOpacity
                                    onPress={props.onOpenEqualizerModal}
                                    style={{
                                        padding: 8,
                                        backgroundColor: '#1F1F1F',
                                        borderRadius: 20,
                                        borderWidth: 1,
                                        borderColor: '#333',
                                        opacity: props.equalizerEnabled ? 1 : 0.5,
                                    }}
                                    disabled={!props.equalizerEnabled}
                                >
                                    <Feather name="sliders" size={16} color="#FFF" />
                                </TouchableOpacity>

                                <Switch
                                    value={props.equalizerEnabled}
                                    onValueChange={props.onToggleEqualizer}
                                    trackColor={{ false: '#333', true: '#666' }}
                                    thumbColor={props.equalizerEnabled ? '#FFF' : '#999'}
                                />
                            </View>
                        </View>

                        {/* Quick Preset Selector */}
                        <Text style={[styles.sectionHeader, !props.equalizerEnabled && { opacity: 0.5 }]}>Quick Presets</Text>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.presetsList}
                            style={[styles.presetsScroll, !props.equalizerEnabled && { opacity: 0.5 }]}
                            pointerEvents={props.equalizerEnabled ? 'auto' : 'none'}
                        >
                            {EQUALIZER_PRESETS.map(preset => {
                                const isActive = props.equalizerPreset === preset.id;
                                return (
                                    <Pressable
                                        key={preset.id}
                                        style={[styles.presetChip, isActive && styles.presetChipActive]}
                                        onPress={() => props.onSelectPreset?.(preset.id)}
                                        disabled={!props.equalizerEnabled}
                                    >
                                        <Text style={[styles.presetText, isActive && styles.presetTextActive]}>
                                            {preset.name}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    </ScrollView>
                );
            }

            return (
                <FlashList
                    data={filteredTracks}
                    renderItem={renderTrackItem}
                    keyExtractor={(item, index) => item.index?.toString() ?? `audio-${index}`}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <EmptyState message="No audio tracks available" iconName="music" />
                    }
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
                        ListHeaderComponent={OffOption}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={EmbeddedEmpty}
                    />
                );

            case 'external':
                return (
                    <FlashList
                        data={externalSubtitles}
                        renderItem={renderExternalItem}
                        keyExtractor={(item, index) => `${item.name}-${index}`}
                        ListHeaderComponent={ExternalHeader}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={ExternalEmpty}
                    />
                );

            case 'online':
                return (
                    <FlashList
                        data={searchResults}
                        renderItem={renderOnlineItem}
                        keyExtractor={(item, index) => item.id ?? `online-${index}`}
                        ListHeaderComponent={OnlineHeader}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={OnlineEmpty}
                    />
                );

            default:
                return null;
        }
    }, [
        type,
        activeTab,
        filteredTracks,
        renderTrackItem,
        OffOption,
        externalSubtitles,
        renderExternalItem,
        ExternalHeader,
        searchResults,
        renderOnlineItem,
        OnlineHeader,
        EmbeddedEmpty,
        ExternalEmpty,
        OnlineEmpty,
        audioTab,
        props.equalizerPreset,
        props.equalizerEnabled,
        props.onOpenEqualizerModal,
        props.onToggleEqualizer,
        props.onSelectPreset,
    ]);

    // ---- Render ----
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={handleClose}
            statusBarTranslucent
            navigationBarTranslucent
        >
            <Pressable style={styles.overlay} onPress={handleClose}>
                <Pressable style={styles.modalContainer} onPress={(e) => e.stopPropagation()}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            <View style={styles.iconContainer}>
                                <IconComponent size={20} color="#CCCCCC" />
                            </View>
                            <Text style={styles.title}>{title}</Text>
                        </View>
                        <View style={styles.headerRight}>
                            <Pressable
                                onPress={() => {
                                    onOpenSyncPanel?.(type);
                                    onClose();
                                }}
                                style={styles.headerSyncButton}
                                hitSlop={12}
                            >
                                <Feather name="clock" size={16} color="#CCCCCC" />
                                <Text style={styles.syncButtonText}>Sync Adjust</Text>
                            </Pressable>
                            <Pressable onPress={handleClose} style={styles.closeButton} hitSlop={12}>
                                <Feather name="x" size={22} color="#808080" />
                            </Pressable>
                        </View>
                    </View>

                    {/* Tab Bar */}
                    {TabBar}

                    {/* Content */}
                    <View style={styles.contentWrapper}>{renderContent()}</View>
                </Pressable>
            </Pressable>
        </Modal>
    );
});

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.85)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContainer: {
        width: '90%',
        maxWidth: 420,
        height: '85%',
        backgroundColor: '#0A0A0A',
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.5,
        shadowRadius: 24,
        elevation: 12,
        flexDirection: 'column',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#1A1A1A',
        backgroundColor: '#0A0A0A',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    iconContainer: {
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: '#0F0F0F',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        color: '#CCCCCC',
        fontSize: 18,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    closeButton: {
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: '#0F0F0F',
        alignItems: 'center',
        justifyContent: 'center',
    },
    tabBar: {
        flexDirection: 'row',
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#1A1A1A',
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: 10,
        backgroundColor: '#121212',
    },
    tabActive: {
        backgroundColor: '#2A2A2A',
    },
    tabText: {
        color: '#666666',
        fontSize: 12,
        fontWeight: '600',
    },
    tabTextActive: {
        color: '#FFFFFF',
    },
    contentWrapper: {
        flex: 1,
    },
    listContent: {
        padding: 12,
        paddingBottom: 20,
    },
    trackItem: {
        backgroundColor: '#121212',
        borderRadius: 12,
        marginBottom: 8,
        borderWidth: 1.5,
        borderColor: '#1A1A1A',
        overflow: 'hidden',
        minHeight: 64,
    },
    trackItemSelected: {
        backgroundColor: '#1A1A1A',
        borderColor: '#CCCCCC80',
    },
    trackItemPressed: {
        opacity: 0.7,
        transform: [{ scale: 0.98 }],
    },
    trackMain: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
    },
    trackLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        gap: 10,
        marginRight: 8,
    },
    trackIconBadge: {
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: '#0F0F0F',
        alignItems: 'center',
        justifyContent: 'center',
    },
    trackIconBadgeActive: {
        backgroundColor: '#262626',
    },
    trackIconBadgeSDH: {
        backgroundColor: '#1B3D1B',
    },
    trackNumber: {
        color: '#666666',
        fontSize: 13,
        fontWeight: '600',
    },
    trackNumberActive: {
        color: '#CCCCCC',
    },
    trackInfo: {
        flex: 1,
        gap: 2,
        justifyContent: 'center',
    },
    trackTitle: {
        color: '#CCCCCC',
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: 0.2,
    },
    trackTitleActive: {
        color: '#FFFFFF',
    },
    trackSubtitle: {
        color: '#666666',
        fontSize: 11,
        lineHeight: 15,
        letterSpacing: 0.1,
    },
    checkBadge: {
        width: 30,
        height: 30,
        borderRadius: 8,
        backgroundColor: '#0F0F0F',
        alignItems: 'center',
        justifyContent: 'center',
    },
    browseButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#1A1A1A',
        borderRadius: 12,
        paddingVertical: 14,
        marginBottom: 8,
        borderWidth: 1.5,
        borderColor: '#2A2A2A',
    },
    browseButtonPressed: {
        opacity: 0.7,
        transform: [{ scale: 0.98 }],
    },
    browseButtonText: {
        color: '#CCCCCC',
        fontSize: 14,
        fontWeight: '600',
    },
    searchContainer: {
        gap: 8,
        marginBottom: 8,
    },
    searchInputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#121212',
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#1A1A1A',
        paddingHorizontal: 12,
        height: 48,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        color: '#CCCCCC',
        fontSize: 14,
        paddingVertical: 0,
    },
    searchButton: {
        backgroundColor: '#2A2A2A',
        borderRadius: 12,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchButtonDisabled: {
        opacity: 0.5,
    },
    searchButtonText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        paddingHorizontal: 24,
    },
    emptyIcon: {
        marginBottom: 16,
        opacity: 0.5,
    },
    emptyText: {
        color: '#666666',
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
    },
    effectsContainer: {
        flex: 1,
    },
    effectsContent: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 20,
    },
    effectItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#1A1A1A',
        marginBottom: 12,
    },
    effectInfo: {
        flex: 1,
    },
    effectTitle: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 4,
    },
    effectSubtitle: {
        color: '#666666',
        fontSize: 12,
    },
    sectionHeader: {
        color: '#999',
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    presetsScroll: {
        marginHorizontal: -20,
        marginBottom: 4,
    },
    presetsList: {
        gap: 8,
        paddingHorizontal: 20,
    },
    presetChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: '#1F1F1F',
        borderWidth: 1,
        borderColor: '#333',
    },
    presetChipActive: {
        backgroundColor: '#FFFFFF',
        borderColor: '#FFFFFF',
    },
    presetText: {
        color: '#CCCCCC',
        fontSize: 12,
        fontWeight: '500',
    },
    presetTextActive: {
        color: '#000000',
    },
    divider: {
        height: 1,
        backgroundColor: '#333333',
        marginVertical: 12,
        marginHorizontal: 16,
    },
    syncButton: {
        padding: 10,
        backgroundColor: '#1F1F1F',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#333',
        justifyContent: 'center',
        alignItems: 'center',
    },
    syncHeaderButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#1A1A1A',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
        marginBottom: 12,
        gap: 12,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerSyncButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        height: 34,
        borderRadius: 10,
        backgroundColor: '#161616',
    },
    syncButtonText: {
        color: '#CCCCCC',
        fontSize: 11,
        fontWeight: '600',
    },
});