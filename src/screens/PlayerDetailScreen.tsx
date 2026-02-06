// src/screens/PlayerDetailScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    FlatList,
    Modal,
    Alert,
    ToastAndroid,
    Platform,
    Image,
    ScrollView,
    Dimensions,
    StatusBar,
    Animated, // Added
    Easing,   // Added
    useWindowDimensions, // Added
} from 'react-native';
import FastImage from 'react-native-fast-image';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from '@react-native-vector-icons/feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { useAppStore } from '../store/appStore';
import { ContentDetector } from '../services/ContentDetector';
import { OMDBResult } from '../services/OMDBService';
import { SubtitleExtractor, SubtitleTrack } from '../utils/SubtitleExtractor';
import { SubtitleParser } from '../utils/SubtitleParser';
import { SubtitleSelectionService } from '../services/SubtitleSelectionService';
import { SubtitlePickerService } from '../services/SubtitlePickerService';
import { searchSDHSubtitles, downloadSubtitle } from '../utils/subdlApi';
import { RootStackParamList, SubtitleResult, SubtitleCue } from '../types';
import { HapticsIcon, ImdbIcon, RottenTomatoesIcon } from '../components/VideoPlayer/PlayerIcons';

type DetailRouteProp = RouteProp<RootStackParamList, 'PlayerDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const LOG_PREFIX = '[PlayerDetail]';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = Math.min(SCREEN_WIDTH * 1.2, 500);

function showToast(message: string) {
    if (Platform.OS === 'android') {
        ToastAndroid.show(message, ToastAndroid.SHORT);
    }
}

export default function PlayerDetailScreen() {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const route = useRoute<DetailRouteProp>();
    const navigation = useNavigation<NavigationProp>();
    const { settings } = useAppStore();
    const { width, height } = useWindowDimensions();
    const isLandscape = width > height;

    // Calculate dynamic hero height for portrait
    const portraitHeroHeight = Math.min(width * 1.2, 500);

    const { videoPath, videoName, albumName } = route.params;

    // Flow state
    const [loading, setLoading] = useState(false);
    const [processingStep, setProcessingStep] = useState<string>('');
    const [movieDetails, setMovieDetails] = useState<OMDBResult | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(true);

    // State for progressive image loading
    const imageOpacity = useRef(new Animated.Value(0)).current;

    // Helper to get high-resolution poster
    const getHighResPoster = useCallback((url: string) => {
        if (!url || url === 'N/A') return url;
        // Replaces _SX300.jpg, _SY1000.jpg, _CR0,0,0,0.jpg etc with .jpg
        return url.replace(/_S[XY]\d+(?:_CR\d+,\d+,\d+,\d+)?.*?\.jpg$/i, '.jpg');
    }, []);

    // Subtitle data
    const [embeddedTracks, setEmbeddedTracks] = useState<SubtitleTrack[]>([]);
    const [apiSubtitles, setApiSubtitles] = useState<SubtitleResult[]>([]);
    const [hapticCues, setHapticCues] = useState<SubtitleCue[] | null>(null);
    const [sdhSource, setSdhSource] = useState<string>('');

    // Manual picker modal
    const [showManualPicker, setShowManualPicker] = useState(false);
    const [localSubtitles, setLocalSubtitles] = useState<string[]>([]);

    // Run detection on mount
    useEffect(() => {
        initPage();
    }, [videoName]);

    async function initPage() {
        setDetailsLoading(true);
        let imdbId: string | undefined;

        // 1. Try to get movie details first
        try {
            console.log(`${LOG_PREFIX} Loading movie details/ID for: ${videoName}`);
            const classification = await ContentDetector.classify(videoName, true);

            if (classification.omdbData) {
                console.log(`${LOG_PREFIX} Movie details loaded:`, classification.parsedTitle);
                setMovieDetails(classification.omdbData);
                imdbId = classification.omdbData.imdbID;
            } else {
                console.log(`${LOG_PREFIX} No movie details found`);
            }
        } catch (error) {
            console.warn(`${LOG_PREFIX} Failed to load details:`, error);
        } finally {
            setDetailsLoading(false);
        }

        // 2. Start SDH detection (if enabled)
        if (settings.hapticSettings.enabled) {
            runSDHDetection(imdbId);
        } else {
            setProcessingStep('');
        }
    }

    async function runSDHDetection(imdbId?: string) {
        setLoading(true);
        setProcessingStep('Scanning for SDH subtitles...');

        try {
            // Step 1: Get embedded subtitle tracks
            console.log(`${LOG_PREFIX} Getting embedded tracks...`);
            const tracks = await SubtitleExtractor.getSubtitleTracks(videoPath);
            setEmbeddedTracks(tracks);
            console.log(`${LOG_PREFIX} Found ${tracks.length} embedded tracks`);

            // Step 2: Check for local subtitle files
            const locals = await SubtitlePickerService.findMatchingSubtitles(videoPath);
            setLocalSubtitles(locals);
            console.log(`${LOG_PREFIX} Found ${locals.length} local subtitle files`);

            // Step 3: Try to find SDH content in embedded tracks
            if (tracks.length > 0) {
                setProcessingStep('Checking embedded subtitles for SDH content...');

                const extractAndParse = async (index: number): Promise<SubtitleCue[] | null> => {
                    try {
                        const extractedPath = await SubtitleExtractor.extractSubtitle(videoPath, index, 'srt');
                        if (!extractedPath) return null;
                        const content = await SubtitleExtractor.readSubtitleFile(extractedPath);
                        if (!content) return null;
                        return SubtitleParser.parse(content, 'srt');
                    } catch (e) {
                        console.error(`${LOG_PREFIX} Extract error:`, e);
                        return null;
                    }
                };

                const sdhResult = await SubtitleSelectionService.findBestSDHByContent(
                    tracks,
                    extractAndParse,
                    'en'
                );

                if (sdhResult) {
                    console.log(`${LOG_PREFIX} ✓ Found SDH in embedded track ${sdhResult.track.index}`);
                    setHapticCues(sdhResult.cues);
                    setSdhSource(`Embedded: ${sdhResult.track.title || sdhResult.track.language || 'Track ' + sdhResult.track.index}`);
                    setLoading(false);
                    setProcessingStep('');
                    return;
                }
            }

            // Step 4: Try local subtitle files
            if (locals.length > 0) {
                setProcessingStep('Checking local subtitle files...');

                for (const localPath of locals) {
                    try {
                        const picked = await SubtitlePickerService.loadFromPath(localPath);
                        if (picked && picked.cues.length > 0) {
                            const validation = SubtitleSelectionService.validateSDHContent(picked.cues);
                            if (validation.isSDH) {
                                console.log(`${LOG_PREFIX} ✓ Found SDH in local file: ${picked.name}`);
                                setHapticCues(picked.cues);
                                setSdhSource(`Local: ${picked.name}`);
                                setLoading(false);
                                setProcessingStep('');
                                return;
                            }
                        }
                    } catch (e) {
                        console.error(`${LOG_PREFIX} Local file error:`, e);
                    }
                }
            }

            // Step 5: Search API for subtitles
            setProcessingStep('Searching online for SDH subtitles...');
            console.log(`${LOG_PREFIX} Searching API with:`, { videoName, imdbId });
            const apiResult = await searchSDHSubtitles(videoName, 'en', imdbId);

            setApiSubtitles(apiResult.subtitles);
            console.log(`${LOG_PREFIX} API returned ${apiResult.subtitles.length} subtitles`);

            if (apiResult.subtitles.length > 0) {
                // Simplified Logic: Just pick the first one flagged as HI/SDH
                const bestAPI = apiResult.subtitles.find(s => s.hearingImpaired || (s.sdhScore && s.sdhScore > 5));

                if (bestAPI) {
                    setProcessingStep('Downloading SDH subtitle...');
                    const content = await downloadSubtitle(bestAPI.downloadUrl);

                    if (content) {
                        const cues = SubtitleParser.parse(content, 'srt');
                        // Basic validation to ensure we actually got cues
                        if (cues.length > 0) {
                            console.log(`${LOG_PREFIX} ✓ Auto-selected SDH: ${bestAPI.release}`);
                            setHapticCues(cues);
                            setSdhSource(`Online: ${bestAPI.release}`);
                            setLoading(false);
                            setProcessingStep('');
                            return;
                        }
                    }
                }
            }

            // No SDH found automatically
            console.log(`${LOG_PREFIX} No SDH subtitle found automatically`);
            setLoading(false);
            setProcessingStep('');

        } catch (error) {
            console.error(`${LOG_PREFIX} Detection error:`, error);
            setLoading(false);
            setProcessingStep('');
        }
    }

    function navigateToPlayer(cues?: SubtitleCue[] | null) {
        navigation.navigate('VideoPlayer', {
            videoPath,
            videoName,
            cleanTitle: movieDetails?.Title,
            albumName,
            imdbId: movieDetails?.imdbID,
            playMode: cues && cues.length > 0 ? 'with-haptics' : 'normal',
            hapticCues: cues || undefined,
            apiSubtitles: apiSubtitles.length > 0 ? apiSubtitles : undefined,
        });
    }

    async function handlePickFromStorage() {
        try {
            setLoading(true);
            setProcessingStep('Opening file picker...');

            const picked = await SubtitlePickerService.pickFromStorage();

            if (!picked) {
                setLoading(false);
                return;
            }

            setProcessingStep('Validating subtitle...');
            const validation = SubtitleSelectionService.validateSDHContent(picked.cues);

            if (!validation.isSDH) {
                Alert.alert(
                    'SDH Content Warning',
                    'This subtitle may not contain sound descriptions for haptic feedback.\n\nDo you want to use it anyway?',
                    [
                        { text: 'Cancel', style: 'cancel', onPress: () => setLoading(false) },
                        {
                            text: 'Use Anyway',
                            onPress: () => {
                                setShowManualPicker(false);
                                setLoading(false);
                                navigateToPlayer(picked.cues);
                            },
                        },
                    ]
                );
                return;
            }

            showToast('SDH subtitle loaded');
            setShowManualPicker(false);
            setLoading(false);
            navigateToPlayer(picked.cues);
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Could not load subtitle file');
            setLoading(false);
        }
    }

    async function handleSelectLocalSubtitle(path: string) {
        try {
            setLoading(true);
            setProcessingStep('Loading subtitle...');

            const picked = await SubtitlePickerService.loadFromPath(path);

            if (!picked) {
                Alert.alert('Error', 'Could not load subtitle file');
                setLoading(false);
                return;
            }

            const validation = SubtitleSelectionService.validateSDHContent(picked.cues);
            if (!validation.isSDH) {
                showToast('Warning: May not contain SDH content');
            }

            setShowManualPicker(false);
            setLoading(false);
            navigateToPlayer(picked.cues);
        } catch (error) {
            Alert.alert('Error', 'Could not load subtitle');
            setLoading(false);
        }
    }

    async function handleSelectAPISubtitle(sub: SubtitleResult) {
        try {
            setLoading(true);
            setProcessingStep('Downloading subtitle...');

            const content = await downloadSubtitle(sub.downloadUrl);
            if (!content) {
                Alert.alert('Error', 'Could not download subtitle');
                setLoading(false);
                return;
            }

            const cues = SubtitleParser.parse(content, 'srt');

            setShowManualPicker(false);
            setLoading(false);
            navigateToPlayer(cues);
        } catch (error) {
            Alert.alert('Error', 'Failed to download');
            setLoading(false);
        }
    }

    function handlePlayNormal() {
        navigateToPlayer(null);
    }

    function handlePlayWithHaptics() {
        if (hapticCues && hapticCues.length > 0) {
            navigateToPlayer(hapticCues);
        } else {
            setShowManualPicker(true);
        }
    }

    const renderLocalSubtitle = ({ item }: { item: string }) => {
        const fileName = item.substring(item.lastIndexOf('/') + 1);
        return (
            <TouchableOpacity
                style={[styles.subtitleItem, { borderBottomColor: theme.colors.border }]}
                onPress={() => handleSelectLocalSubtitle(item)}
                activeOpacity={0.7}
            >
                <View style={styles.subtitleRow}>
                    <Feather name="file-text" size={18} color={theme.colors.primary} />
                    <View style={styles.subtitleTextWrap}>
                        <Text style={[styles.subtitleName, { color: theme.colors.text }]} numberOfLines={1}>
                            {fileName}
                        </Text>
                        <Text style={[styles.subtitleInfo, { color: theme.colors.textSecondary }]}>
                            Local file
                        </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={theme.colors.textSecondary} />
                </View>
            </TouchableOpacity>
        );
    };

    const renderAPISubtitle = ({ item }: { item: SubtitleResult }) => {
        const isSDH = (item.sdhScore || 0) > 5 || item.hearingImpaired;
        return (
            <TouchableOpacity
                style={[styles.subtitleItem, { borderBottomColor: theme.colors.border }]}
                onPress={() => handleSelectAPISubtitle(item)}
                activeOpacity={0.7}
            >
                <View style={styles.subtitleRow}>
                    <Feather
                        name={isSDH ? "headphones" : "file-text"}
                        size={18}
                        color={isSDH ? theme.colors.primary : theme.colors.textSecondary}
                    />
                    <View style={styles.subtitleTextWrap}>
                        <Text style={[styles.subtitleName, { color: theme.colors.text }]} numberOfLines={1}>
                            {item.release || item.name}
                        </Text>
                        <Text style={[styles.subtitleInfo, { color: theme.colors.textSecondary }]}>
                            {item.language} • {item.author} {isSDH ? '• SDH' : ''}
                        </Text>
                    </View>
                    <Feather name="download" size={16} color={theme.colors.textSecondary} />
                </View>
            </TouchableOpacity>
        );
    };

    const hasHaptics = hapticCues && hapticCues.length > 0;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={[
                    styles.floatingBack,
                    {
                        top: insets.top + 8,
                        backgroundColor: theme.colors.surface,
                    },
                ]}
                activeOpacity={0.7}
            >
                <Feather name="chevron-left" size={22} color={theme.colors.text} />
            </TouchableOpacity>

            {/* Info about haptics - Absolute Top */}
            {/* <View
                style={[
                    styles.infoBox,
                    {
                        top: "25%",
                        backgroundColor: theme.colors.surface,
                        borderColor: theme.colors.border,
                    }
                ]}
            >
                <Feather name="info" size={14} color={theme.colors.primary} style={{ marginTop: 2 }} />
                <Text style={[styles.infoBoxText, { color: theme.colors.textSecondary }]}>
                    Haptics are generated from SDH subtitles. Quality depends on subtitle accuracy. Edit .srt files to add custom sound keywords.
                </Text>
            </View> */}

            {/* Fixed Hero Image - Absolute Background */}
            <View style={[
                styles.heroContainer,
                isLandscape ? {
                    width: '40%',
                    height: '100%',
                    right: undefined, // Clear right
                } : {
                    height: portraitHeroHeight,
                    width: '100%',
                }
            ]}>
                {movieDetails ? (
                    movieDetails.Poster && movieDetails.Poster !== 'N/A' ? (
                        <View style={styles.imageWrapper}>
                            <Image
                                source={{ uri: movieDetails.Poster }}
                                style={[styles.heroImage, StyleSheet.absoluteFill]}
                                resizeMode="cover"
                                blurRadius={5}
                            />
                            <Animated.View style={[styles.heroImage, StyleSheet.absoluteFill, { opacity: imageOpacity }]}>
                                <FastImage
                                    source={{ uri: getHighResPoster(movieDetails.Poster) }}
                                    style={styles.heroImage}
                                    resizeMode={FastImage.resizeMode.cover}
                                    onLoad={() => {
                                        Animated.timing(imageOpacity, {
                                            toValue: 1,
                                            duration: 600,
                                            useNativeDriver: true,
                                            easing: Easing.out(Easing.quad),
                                        }).start();
                                    }}
                                />
                            </Animated.View>
                        </View>
                    ) : (
                        <View style={[styles.heroPlaceholder, { backgroundColor: theme.colors.card }]}>
                            <Feather name="film" size={60} color={theme.colors.textSecondary} />
                        </View>
                    )
                ) : (
                    <View style={[styles.heroPlaceholder, { backgroundColor: theme.colors.card }]}>
                        {detailsLoading ? (
                            <ActivityIndicator size="large" color={theme.colors.primary} />
                        ) : (
                            <Feather name="video" size={60} color={theme.colors.textSecondary} />
                        )}
                    </View>
                )}
            </View>

            {/* Main content - Scrollable */}
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Spacer for Hero - only in portrait */}
                {!isLandscape && <View style={{ height: portraitHeroHeight }} />}

                {/* Content Card - Slides over hero */}
                <View style={[
                    styles.contentCard,
                    {
                        backgroundColor: theme.colors.background,
                        borderTopLeftRadius: isLandscape ? 0 : 24,
                        borderTopRightRadius: isLandscape ? 0 : 24,
                        marginTop: isLandscape ? 0 : -24,
                        marginLeft: isLandscape ? '40%' : 0, // Push content to right
                        minHeight: isLandscape ? height : height * 0.7,
                        paddingTop: isLandscape ? insets.top + 24 : 24, // Add padding for status bar in landscape
                    }
                ]}>

                    {/* Content Container */}
                    <View style={styles.contentContainer}>

                        {movieDetails ? (
                            <>
                                {/* Title & Metadata */}
                                <Text style={[styles.movieTitle, { color: theme.colors.text }]}>
                                    {movieDetails.Title}
                                </Text>

                                <View style={styles.metaRow}>
                                    <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>{movieDetails.Year}</Text>
                                    <Text style={[styles.metaDot, { color: theme.colors.textSecondary }]}>•</Text>
                                    <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>{movieDetails.Rated || 'Not Rated'}</Text>
                                    <Text style={[styles.metaDot, { color: theme.colors.textSecondary }]}>•</Text>
                                    <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>{movieDetails.Runtime || 'N/A'}</Text>
                                </View>

                                {/* Genre Chips */}
                                <View style={styles.genreRow}>
                                    {movieDetails.Genre?.split(',').map((g, i) => (
                                        <View key={i} style={[styles.genreChip, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                                            <Text style={[styles.genreText, { color: theme.colors.textSecondary }]}>{g.trim()}</Text>
                                        </View>
                                    ))}
                                </View>

                                {/* Ratings */}
                                <View style={styles.ratingsRow}>
                                    {movieDetails.imdbRating && movieDetails.imdbRating !== 'N/A' && (
                                        <View style={styles.ratingItem}>
                                            <ImdbIcon size={20} />
                                            <Text style={[styles.ratingValue, { color: theme.colors.text }]}>
                                                {movieDetails.imdbRating}
                                            </Text>
                                        </View>
                                    )}
                                    {movieDetails.Ratings?.find(r => r.Source === 'Rotten Tomatoes') && (
                                        <View style={styles.ratingItem}>
                                            <RottenTomatoesIcon size={20} />
                                            <Text style={[styles.ratingValue, { color: theme.colors.text }]}>
                                                {movieDetails.Ratings.find(r => r.Source === 'Rotten Tomatoes')?.Value}
                                            </Text>
                                        </View>
                                    )}
                                </View>

                                {/* Action Buttons - Inline */}
                                <View style={styles.actionRow}>
                                    {/* Play Normal */}
                                    <TouchableOpacity
                                        style={[
                                            styles.actionButton,
                                            styles.secondaryButton,
                                            {
                                                backgroundColor: theme.colors.card,
                                                borderColor: theme.colors.border,
                                            },
                                        ]}
                                        onPress={handlePlayNormal}
                                        activeOpacity={0.7}
                                    >
                                        <Feather name="play" size={20} color={theme.colors.text} />
                                        <Text style={[styles.actionButtonText, { color: theme.colors.text }]}>
                                            Standard
                                        </Text>
                                    </TouchableOpacity>

                                    {/* Play Haptics */}
                                    <TouchableOpacity
                                        style={[
                                            styles.actionButton,
                                            styles.primaryButton,
                                            {
                                                backgroundColor: theme.colors.primary,
                                                opacity: loading ? 0.8 : 1
                                            },
                                        ]}
                                        onPress={loading ? undefined : handlePlayWithHaptics}
                                        activeOpacity={0.85}
                                        disabled={loading}
                                    >
                                        {loading ? (
                                            <>
                                                <ActivityIndicator size="small" color={theme.colors.background} />
                                                <Text style={[styles.actionButtonText, { color: theme.colors.background, fontSize: 13 }]}>
                                                    {processingStep.includes('Downloading') ? 'Downloading...' : 'Searching...'}
                                                </Text>
                                            </>
                                        ) : (
                                            <>
                                                <HapticsIcon size={20} color={theme.colors.background} active={true} />
                                                <Text style={[styles.actionButtonText, { color: theme.colors.background }]}>
                                                    Haptic Play
                                                </Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>

                                {/* Plot */}
                                <Text style={[styles.plotText, { color: theme.colors.textSecondary }]}>
                                    {movieDetails.Plot}
                                </Text>

                                {/* Cast info */}
                                <View style={styles.castContainer}>
                                    <View style={styles.castItem}>
                                        <Text style={[styles.castLabel, { color: theme.colors.textSecondary }]}>Director</Text>
                                        <Text style={[styles.castValue, { color: theme.colors.text }]}>{movieDetails.Director}</Text>
                                    </View>
                                    <View style={styles.castItem}>
                                        <Text style={[styles.castLabel, { color: theme.colors.textSecondary }]}>Starring</Text>
                                        <Text style={[styles.castValue, { color: theme.colors.text }]}>{movieDetails.Actors}</Text>
                                    </View>
                                </View>
                            </>
                        ) : (
                            // Fallback View if no details
                            <View style={styles.fallbackContent}>
                                <Text style={[styles.movieTitle, { color: theme.colors.text }]}>{videoName}</Text>

                                <View style={styles.actionRow}>
                                    <TouchableOpacity
                                        style={[styles.actionButton, { backgroundColor: theme.colors.card, borderColor: theme.colors.border, borderWidth: 1 }]}
                                        onPress={handlePlayNormal}
                                    >
                                        <Feather name="play" size={20} color={theme.colors.text} />
                                        <Text style={[styles.actionButtonText, { color: theme.colors.text }]}>Standard</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[styles.actionButton, { backgroundColor: theme.colors.primary }]}
                                        onPress={handlePlayWithHaptics}
                                    >
                                        {loading ? (
                                            <ActivityIndicator color={theme.colors.background} />
                                        ) : (
                                            <>
                                                <HapticsIcon size={20} color={theme.colors.background} active={true} />
                                                <Text style={[styles.actionButtonText, { color: theme.colors.background }]}>Haptic Play</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                </View>
            </ScrollView>

            {/* Manual subtitle picker modal */}
            <Modal visible={showManualPicker} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent>
                <View style={styles.modalContainer}>
                    <View
                        style={[
                            styles.modal,
                            {
                                backgroundColor: theme.colors.card,
                                paddingBottom: Math.max(insets.bottom, 16),
                            },
                        ]}
                    >
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                                Select SDH Subtitle
                            </Text>
                            <TouchableOpacity
                                onPress={() => setShowManualPicker(false)}
                                style={[styles.modalIconBtn, { backgroundColor: theme.colors.surface }]}
                            >
                                <Feather name="x" size={18} color={theme.colors.text} />
                            </TouchableOpacity>
                        </View>

                        {/* Pick from storage button */}
                        <TouchableOpacity
                            style={[styles.pickStorageBtn, { backgroundColor: theme.colors.primary }]}
                            onPress={handlePickFromStorage}
                            activeOpacity={0.85}
                        >
                            <Feather name="folder" size={18} color={theme.colors.background} />
                            <Text style={[styles.pickStorageText, { color: theme.colors.background }]}>
                                Browse Device Storage
                            </Text>
                        </TouchableOpacity>

                        {/* Local subtitles section */}
                        {localSubtitles.length > 0 && (
                            <View style={styles.section}>
                                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                                    Found in video folder
                                </Text>
                                <FlatList
                                    data={localSubtitles}
                                    renderItem={renderLocalSubtitle}
                                    keyExtractor={(item) => item}
                                    style={styles.subtitleList}
                                />
                            </View>
                        )}

                        {/* API subtitles section */}
                        {apiSubtitles.length > 0 && (
                            <View style={styles.section}>
                                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                                    Available online ({apiSubtitles.length})
                                </Text>
                                <FlatList
                                    data={apiSubtitles.slice(0, 15)}
                                    renderItem={renderAPISubtitle}
                                    keyExtractor={(item) => item.id}
                                    style={styles.subtitleList}
                                />
                            </View>
                        )}

                        {/* No subtitles message */}
                        {localSubtitles.length === 0 && apiSubtitles.length === 0 && (
                            <Text style={[styles.noSubsText, { color: theme.colors.textSecondary }]}>
                                No subtitles found. Use "Browse Device Storage" to select a file.
                            </Text>
                        )}

                        {/* Cancel button */}
                        <TouchableOpacity
                            style={[styles.cancelBtn, { backgroundColor: theme.colors.surface }]}
                            onPress={() => setShowManualPicker(false)}
                        >
                            <Text style={[styles.cancelText, { color: theme.colors.text }]}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal >
        </View >
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },

    floatingBack: {
        position: 'absolute',
        left: 12,
        zIndex: 10,
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
    },

    // Layout
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 40,
    },
    heroContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: HERO_HEIGHT,
        maxHeight: 500,
        backgroundColor: '#000',
    },
    heroImage: {
        width: '100%',
        height: '100%',
    },
    imageWrapper: {
        width: '100%',
        height: '100%',
        backgroundColor: '#1a1a1a', // Dark bg while loading
    },
    heroPlaceholder: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    contentCard: {
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        paddingTop: 24,
        minHeight: Dimensions.get('window').height,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 }, // Shadow upwards
        shadowOpacity: 0.1,
        shadowRadius: 10,
    },
    contentContainer: {
        paddingHorizontal: 24,
        paddingBottom: 100, // Extra padding at bottom
    },
    fallbackContent: {
        alignItems: 'center',
        paddingHorizontal: 20,
        marginTop: 20,
    },

    // Typography & Meta
    movieTitle: {
        fontSize: 32,
        fontWeight: '800',
        textAlign: 'center',
        marginBottom: 12,
        letterSpacing: -0.5,
        lineHeight: 38,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        marginBottom: 16,
        gap: 8,
    },
    metaText: {
        fontSize: 14,
        fontWeight: '600',
    },
    metaDot: {
        fontSize: 14,
        opacity: 0.5,
    },
    genreRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 8,
        marginBottom: 24,
    },
    genreChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 100, // Pill shape
        borderWidth: 1,
    },
    genreText: {
        fontSize: 12,
        fontWeight: '600',
    },
    ratingsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
        gap: 20,
    },
    ratingItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    ratingValue: {
        fontSize: 14,
        fontWeight: '700',
    },

    // Inline Actions
    actionRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 32,
        width: '100%',
    },
    actionButton: {
        flex: 1,
        flexDirection: 'row', // sleek landscape layout
        borderRadius: 100, // Pill shape
        paddingVertical: 14, // Compact height
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
    },
    primaryButton: {
        shadowOpacity: 0.3, // Extra glow for primary
    },
    secondaryButton: {
        borderWidth: 1.5,
        elevation: 0, // Flat secondary
    },
    actionButtonText: {
        fontSize: 16,
        fontWeight: '700',
    },

    plotText: {
        fontSize: 16,
        lineHeight: 26,
        textAlign: 'justify', // Cleaner readable text
        opacity: 0.85,
        marginBottom: 32,
    },
    castContainer: {
        gap: 16,
        paddingBottom: 20,
    },
    castItem: {
        gap: 4,
    },
    castLabel: {
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        opacity: 0.7,
    },
    castValue: {
        fontSize: 16,
        fontWeight: '500',
    },

    infoText: {
        fontSize: 13,
        textAlign: 'center',
        marginTop: 8,
    },

    infoBox: {
        position: 'absolute',
        left: 20,
        right: 20,
        zIndex: 5,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },

    infoBoxText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 18,
    },

    // Modal
    modalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },

    modal: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 16,
        maxHeight: '85%',
        gap: 12,
    },

    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },

    modalTitle: {
        fontSize: 20,
        fontWeight: '700',
    },

    modalIconBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },

    pickStorageBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 12,
    },

    pickStorageText: {
        fontSize: 15,
        fontWeight: '600',
    },

    section: {
        marginTop: 8,
    },

    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },

    subtitleList: {
        maxHeight: 200,
    },

    subtitleItem: {
        paddingVertical: 12,
        borderBottomWidth: 1,
    },

    subtitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },

    subtitleTextWrap: { flex: 1 },
    subtitleName: { fontSize: 15, fontWeight: '600' },
    subtitleInfo: { fontSize: 12, marginTop: 2 },

    noSubsText: {
        fontSize: 14,
        textAlign: 'center',
        paddingVertical: 20,
    },

    cancelBtn: {
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 8,
    },

    cancelText: {
        fontSize: 15,
        fontWeight: '600',
    },
});
