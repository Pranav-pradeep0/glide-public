// src/screens/RecentsScreen.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Dimensions,
    RefreshControl,
    Alert,
} from 'react-native';
import { Theme } from '@/theme/theme';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { RootStackParamList, VideoHistoryEntry } from '@/types';
import FastImage from 'react-native-fast-image';
import Feather from 'react-native-vector-icons/Feather';
import Animated, { withTiming, useAnimatedStyle, useSharedValue, FadeInDown, ZoomInRight, LinearTransition } from 'react-native-reanimated';
import { Loader } from '../components/Loader';
import { useVideoHistoryStore } from '../store/videoHistoryStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '@/store/appStore';
import { useTheme } from '@/hooks/useTheme';
import { ThumbnailService } from '@/services/ThumbnailService';
import { NavigationService } from '@/services/NavigationService';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

import { VideoOptionsBottomSheet } from '@/components/VideoOptionsBottomSheet';


type NavigationProp = NativeStackNavigationProp<RootStackParamList>;


const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_SPACING = 12;
const GRID_COLUMNS = 2;
// Calculate dynamic grid item width based on screen width
const GRID_ITEM_WIDTH = (SCREEN_WIDTH - (GRID_SPACING * (GRID_COLUMNS + 1))) / GRID_COLUMNS;
const GRID_ITEM_HEIGHT = GRID_ITEM_WIDTH * 1.1; // Slightly taller than wide
const LIST_ITEM_HEIGHT = 88;
const BATCH_SIZE = 6;


type ViewMode = 'grid' | 'list';
type SortByOption = 'recent' | 'views' | 'name';


interface HistoryItemData extends VideoHistoryEntry {
    loadingThumbnail?: boolean;
    thumbnailPath?: string;
}


interface SectionItem {
    id: string;
    type: 'video' | 'gridRow';
    data?: HistoryItemData;
    videos?: HistoryItemData[];
}


// ============= UTILITY FUNCTIONS =============


function getRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);


    if (days > 0) return days === 1 ? '1 day ago' : `${days} days ago`;
    if (hours > 0) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    if (minutes > 0) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
    return 'Just now';
}


function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}


function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}


function flattenForGrid(videos: HistoryItemData[]): SectionItem[] {
    const flattened: SectionItem[] = [];
    const videoChunks = chunkArray(videos, GRID_COLUMNS);
    videoChunks.forEach((chunk, chunkIndex) => {
        flattened.push({
            id: `gridrow-${chunkIndex}`,
            type: 'gridRow',
            videos: chunk,
        });
    });
    return flattened;
}


function flattenForList(videos: HistoryItemData[]): SectionItem[] {
    return videos.map((video) => ({
        id: `video-${video.videoPath}`,
        type: 'video',
        data: video,
    }));
}


// ============= MEMOIZED COMPONENTS =============


const VideoGridCard = React.memo(
    ({
        item,
        onPress,
        onLongPress,
        theme,
    }: {
        item: HistoryItemData;
        onPress: () => void;
        onLongPress: () => void;
        theme: Theme;
    }) => {
        const progress = item.duration > 0 ? (item.lastPausedPosition / item.duration) * 100 : 0;

        return (
            <Animated.View entering={ZoomInRight.duration(250).springify().damping(30).mass(1).stiffness(200)}>
                <TouchableOpacity
                    onPress={onPress}
                    onLongPress={onLongPress}
                    activeOpacity={0.7}
                    style={[styles.videoGridCard, { backgroundColor: theme.colors.surface }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Play video: ${item.videoName}`}
                >
                    <View style={[styles.videoGridThumbnail, { backgroundColor: theme.colors.border }]}>
                        {item.thumbnailPath ? (
                            <FastImage
                                source={{ uri: item.thumbnailPath, priority: FastImage.priority.high }}
                                style={styles.videoGridThumbnailImage}
                                resizeMode={FastImage.resizeMode.cover}
                            />
                        ) : (
                            <View style={styles.thumbnailPlaceholder}>
                                {item.loadingThumbnail ? (
                                    <ActivityIndicator size="small" color={theme.colors.primary} />
                                ) : (
                                    <Feather name="video" size={32} color={theme.colors.textSecondary} />
                                )}
                            </View>
                        )}
                        <View style={styles.playOverlay}>
                            <Feather name="play" size={28} color="#FFFFFF" />
                        </View>
                        {item.bookmarks.length > 0 && (
                            <View style={[styles.bookmarkBadge, { backgroundColor: theme.colors.background }]}>
                                <Feather name="bookmark" size={10} color={theme.colors.text} />
                                <Text style={[styles.bookmarkBadgeText, { color: theme.colors.text }]}>{item.bookmarks.length}</Text>
                            </View>
                        )}
                        {progress > 0 && (
                            <View style={styles.progressBarContainer}>
                                <View style={[styles.progressBarTrack, { backgroundColor: 'rgba(255,255,255,0.3)' }]} />
                                <View
                                    style={[
                                        styles.progressBar,
                                        { width: `${progress}%`, backgroundColor: theme.colors.primary },
                                    ]}
                                />
                                <View
                                    style={[
                                        styles.sliderKnob,
                                        {
                                            left: `${progress}%`,
                                            backgroundColor: theme.colors.text,
                                            borderColor: 'rgba(0,0,0,0.5)', // Dark gap for grid
                                            borderWidth: 2,
                                        }
                                    ]}
                                />
                            </View>
                        )}
                    </View>
                    <View style={styles.videoGridInfo}>
                        <Text style={[styles.videoGridName, { color: theme.colors.text }]} numberOfLines={2}>
                            {item.videoName}
                        </Text>
                        <View style={styles.metadataRow}>
                            <View style={styles.metadataItem}>
                                <Feather name="eye" size={10} color={theme.colors.textSecondary} />
                                <Text style={[styles.metadataText, { color: theme.colors.textSecondary }]}>
                                    {item.viewCount}
                                </Text>
                            </View>
                            <Text style={[styles.metadataText, { color: theme.colors.textSecondary }]}>•</Text>
                            <Text style={[styles.metadataText, { color: theme.colors.textSecondary }]}>
                                {getRelativeTime(item.lastWatchedTime)}
                            </Text>
                        </View>
                    </View>
                </TouchableOpacity>
            </Animated.View>
        );
    }
);
VideoGridCard.displayName = 'VideoGridCard';


const GridRow = React.memo(
    ({
        item,
        onPress,
        onLongPress,
        theme,
    }: {
        item: SectionItem;
        onPress: (video: HistoryItemData) => void;
        onLongPress: (video: HistoryItemData) => void;
        theme: any;
    }) => (
        <View style={styles.gridRow}>
            {item.videos!.map((video) => (
                <VideoGridCard
                    key={video.videoPath}
                    item={video}
                    onPress={() => onPress(video)}
                    onLongPress={() => onLongPress(video)}
                    theme={theme}
                />
            ))}
        </View>
    )
);
GridRow.displayName = 'GridRow';


const VideoListItem = React.memo(
    ({
        item,
        onPress,
        onMorePress,
        theme,
    }: {
        item: HistoryItemData;
        onPress: () => void;
        onMorePress: () => void;
        theme: Theme;
    }) => {
        const progress = item.duration > 0 ? (item.lastPausedPosition / item.duration) * 100 : 0;

        return (
            <Animated.View
                entering={FadeInDown.duration(400).springify().damping(20).mass(1).stiffness(150)}
                layout={LinearTransition.springify().damping(25).mass(1).stiffness(120)}
            >
                <TouchableOpacity
                    style={[styles.videoItem, { backgroundColor: theme.colors.background, borderColor: theme.colors.surface, borderWidth: 2, elevation: 5, overflow: 'hidden' }]}
                    onPress={onPress}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Play video: ${item.videoName}`}
                >
                    <View style={[styles.videoThumbnail, { backgroundColor: theme.colors.background }]}>
                        {item.thumbnailPath ? (
                            <FastImage
                                source={{ uri: item.thumbnailPath, priority: FastImage.priority.high }}
                                style={styles.videoThumbnailImage}
                                resizeMode={FastImage.resizeMode.cover}
                            />
                        ) : (
                            <View style={styles.thumbnailPlaceholder}>
                                {item.loadingThumbnail ? (
                                    <ActivityIndicator size="small" color={theme.colors.primary} />
                                ) : (
                                    <Feather name="video" size={24} color={theme.colors.textSecondary} />
                                )}
                            </View>
                        )}
                        {/* Removed small play badge to match cleaner Folder look, or keep it subtle? Folders don't have play badge on list item. Keeping it clean. */}
                    </View>
                    <View style={styles.videoInfo}>
                        <Text style={[styles.videoName, { color: theme.colors.text }]} numberOfLines={1}>
                            {item.videoName}
                        </Text>
                        <View style={styles.videoMetadata}>
                            {/* Simplified metadata to match Folder's 'Count videos' look mostly, but we have specific metadata */}
                            {/* Merging into one line similar to '15 videos' */}
                            <Text style={[styles.videoSize, { color: theme.colors.textSecondary }]}>
                                {item.viewCount} views • {getRelativeTime(item.lastWatchedTime)}
                            </Text>
                        </View>
                    </View>
                    <TouchableOpacity
                        style={styles.moreButton}
                        onPress={onMorePress}
                        hitSlop={15}
                    >
                        <Feather name="more-vertical" size={20} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                </TouchableOpacity>
                {progress > 0 && (
                    <View style={styles.progressBarContainerListWrapper}>
                        <View style={styles.progressBarContainerList}>
                            <View style={[styles.progressBarTrack, { backgroundColor: theme.colors.border }]} />
                            <View
                                style={[
                                    styles.progressBar,
                                    { width: `${progress}%`, backgroundColor: theme.colors.primary },
                                ]}
                            />
                            <View
                                style={[
                                    styles.sliderKnob,
                                    {
                                        left: `${progress}%`,
                                        backgroundColor: theme.colors.text,
                                        borderColor: theme.colors.background, // Match background to create gap
                                        borderWidth: 2,
                                    }
                                ]}
                            />
                            {/* Time indicator floating above knob */}
                            <View
                                style={[
                                    styles.timeFloatContainer,
                                    {
                                        left: `${progress}%`,
                                        opacity: .6
                                    }
                                ]}
                            >
                                <View style={[styles.timeFloatBubble]}>
                                    <Text style={[styles.timeFloatText, { color: theme.colors.text }]}>
                                        {formatTime(item.lastPausedPosition)}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </View>
                )}
            </Animated.View>
        );
    }
);
VideoListItem.displayName = 'VideoListItem';


// ============= MAIN COMPONENT =============


export default function RecentsScreen() {
    const theme = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const insets = useSafeAreaInsets();

    const { getAllHistory, clearVideoHistory, hydrateFromStorage, isHydrated, updateVideoHistory } = useVideoHistoryStore();
    const { settings, updateSettings } = useAppStore();

    const [history, setHistory] = useState<HistoryItemData[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [sortBy, setSortBy] = useState<SortByOption>('recent');

    // Options Menu State
    const [selectedVideo, setSelectedVideo] = useState<VideoHistoryEntry | null>(null);
    const selectedVideoRef = useRef<VideoHistoryEntry | null>(null);
    const [optionsVisible, setOptionsVisible] = useState(false);

    // Keep ref in sync with state
    useEffect(() => {
        selectedVideoRef.current = selectedVideo;
    }, [selectedVideo]);

    const isMountedRef = useRef(true);
    const flattenedDataRef = useRef<SectionItem[]>([]);
    const thumbnailGenerationRef = useRef<Set<string>>(new Set());

    // ============= ANIMATED SORT INDICATOR =============
    const indicatorLeft = useSharedValue(0);
    const indicatorWidth = useSharedValue(0);
    const buttonLayouts = useRef<{ [key in SortByOption]: { x: number; width: number } | null }>({
        recent: null,
        views: null,
        name: null,
    });
    const animatedIndicatorStyle = useAnimatedStyle(() => ({
        left: indicatorLeft.value,
        width: indicatorWidth.value,
    }));

    useEffect(() => {
        const layout = buttonLayouts.current[sortBy];
        if (layout) {
            indicatorLeft.value = withTiming(layout.x, { duration: 250 });
            indicatorWidth.value = withTiming(layout.width, { duration: 250 });
        }
    }, [sortBy]);

    // ============= LIFECYCLE =============

    useEffect(() => {
        isMountedRef.current = true;

        const initializeScreen = async () => {
            try {
                if (!isHydrated) {
                    await hydrateFromStorage();
                }
            } catch (error) {
                console.error('[RecentsScreen] Initialization error:', error);
            }
        };

        initializeScreen();

        return () => {
            isMountedRef.current = false;
        };
    }, [hydrateFromStorage, isHydrated]);

    useEffect(() => {
        if (isHydrated) {
            loadHistory();
        }
    }, [isHydrated]);

    useFocusEffect(
        useCallback(() => {
            if (isHydrated) {
                loadHistory();
            }
        }, [isHydrated])
    );

    const generateThumbnailForVideo = useCallback(async (video: HistoryItemData): Promise<string | null> => {
        try {
            return await ThumbnailService.getThumbnail(video.videoPath, video.lastPausedPosition * 1000);
        } catch (error) {
            console.error('[RecentsScreen] Thumbnail generation error:', error);
            return null;
        }
    }, []);

    const loadThumbnailsForHistory = useCallback(async (items: HistoryItemData[]) => {
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            if (!isMountedRef.current) break;

            const batch = items.slice(i, i + BATCH_SIZE);

            await Promise.all(
                batch.map(async (video) => {
                    if (video.thumbnailPath) return;

                    setHistory(prev =>
                        prev.map(v =>
                            v.videoPath === video.videoPath
                                ? { ...v, loadingThumbnail: true }
                                : v
                        )
                    );

                    const thumbnailPath = await generateThumbnailForVideo(video);

                    if (isMountedRef.current) {
                        setHistory(prev =>
                            prev.map(v =>
                                v.videoPath === video.videoPath
                                    ? { ...v, thumbnailPath: thumbnailPath || undefined, loadingThumbnail: false }
                                    : v
                            )
                        );
                    }
                })
            );
            // Small delay between batches to yield to UI
            if (i + BATCH_SIZE < items.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }, [generateThumbnailForVideo]);

    async function loadHistory() {
        if (!isMountedRef.current) return;
        setLoading(true);

        try {
            const allHistory = getAllHistory();
            const historyWithThumbnails: HistoryItemData[] = allHistory.map((h) => ({
                ...h,
                loadingThumbnail: false,
                thumbnailPath: undefined,
            }));

            if (isMountedRef.current) {
                setHistory(historyWithThumbnails);
                setLoading(false);
                loadThumbnailsForHistory(historyWithThumbnails);
            }
        } catch (error) {
            console.error('[RecentsScreen] Load error:', error);
            if (isMountedRef.current) {
                setLoading(false);
            }
        }
    }

    async function handleRefresh() {
        if (!isMountedRef.current) return;
        setRefreshing(true);

        try {
            await hydrateFromStorage();
            loadHistory();
        } catch (error) {
            console.error('[RecentsScreen] Refresh error:', error);
        } finally {
            if (isMountedRef.current) {
                setRefreshing(false);
            }
        }
    }

    // ============= SORTING =============

    function sortHistory(items: HistoryItemData[], sortOption: SortByOption): HistoryItemData[] {
        const itemsCopy = [...items];
        switch (sortOption) {
            case 'name':
                return itemsCopy.sort((a, b) => a.videoName.localeCompare(b.videoName));
            case 'recent':
                return itemsCopy.sort((a, b) => b.lastWatchedTime - a.lastWatchedTime);
            case 'views':
                return itemsCopy.sort((a, b) => b.viewCount - a.viewCount);
            default:
                return itemsCopy;
        }
    }

    const sortedHistory = useMemo(() => sortHistory(history, sortBy), [history, sortBy]);

    const flattenedData = useMemo(() => {
        if (viewMode === 'list') {
            return flattenForList(sortedHistory);
        } else {
            return flattenForGrid(sortedHistory);
        }
    }, [sortedHistory, viewMode]);

    useEffect(() => {
        flattenedDataRef.current = flattenedData;
    }, [flattenedData]);

    // ============= EVENT HANDLERS =============

    function handleVideoPress(video: HistoryItemData) {
        if (!video.videoPath) return;
        NavigationService.handleVideoNavigation(navigation, video.videoPath, {
            videoName: video.videoName,
        });
    }

    const handleOpenOptions = useCallback((video: HistoryItemData) => {
        console.log('[RecentsScreen] handleOpenOptions called:', {
            videoName: video.videoName,
            videoPath: video.videoPath,
        });
        setSelectedVideo(video);
        setOptionsVisible(true);
        console.log('[RecentsScreen] optionsVisible set to true');
    }, []);

    const toggleViewMode = useCallback(() => setViewMode((prev) => (prev === 'grid' ? 'list' : 'grid')), []);

    const handleSortChange = useCallback((newSort: SortByOption) => setSortBy(newSort), []);

    const toggleTheme = useCallback(() => {
        updateSettings({ darkMode: !settings.darkMode });
    }, [settings.darkMode, updateSettings]);

    // --- Options Handlers ---

    // --- Options Handlers ---

    const handleDelete = async () => {
        const video = selectedVideoRef.current;
        if (!video) {
            console.error('[RecentsScreen] handleDelete: No video selected - selectedVideoRef is null');
            return;
        }

        const videoPath = video.videoPath;
        const contentUri = video.contentUri; // Original content:// URI stored in history

        console.log('[RecentsScreen] handleDelete started:', {
            videoPath,
            contentUri,
            videoName: video.videoName,
        });

        if (!contentUri) {
            console.error('[RecentsScreen] handleDelete: No contentUri available for deletion');
            Alert.alert(
                'Cannot Delete',
                'This video was watched before the delete feature was updated. Please delete it from the Folders screen instead.'
            );
            return;
        }

        try {
            // Use CameraRoll.deletePhotos with the stored content:// URI
            console.log('[RecentsScreen] Attempting CameraRoll.deletePhotos with URI:', contentUri);
            await CameraRoll.deletePhotos([contentUri]);
            console.log('[RecentsScreen] File deleted successfully via CameraRoll:', contentUri);
            clearVideoHistory(videoPath);
            loadHistory();
        } catch (error) {
            console.error('[RecentsScreen] Delete failed:', {
                error,
                videoPath,
                contentUri,
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
            });
            Alert.alert('Delete Failed', 'Could not delete the file. Please check permissions.');
        }
    };

    const handleClearHistoryItem = () => {
        const video = selectedVideoRef.current;
        if (!video) return;
        clearVideoHistory(video.videoPath);
        loadHistory();
    };

    const handleShare = async () => {
        const video = selectedVideoRef.current;
        if (!video) return;
        try {
            await Share.open({
                url: `file://${video.videoPath}`,
                type: 'video/*',
                failOnCancel: false,
            });
        } catch (error) {
            console.log('Share dismissed', error);
        }
    };

    // ============= KEY EXTRACTOR =============

    const keyExtractor = useCallback((item: SectionItem) => item.id, []);

    // ============= RENDER FUNCTIONS =============

    const renderHeader = useCallback(
        () => (
            <View style={styles.header}>
                <View>
                    <Text style={[styles.title, { color: theme.colors.text }]}>Recents</Text>
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        {sortedHistory.length} video{sortedHistory.length !== 1 ? 's' : ''}
                    </Text>
                </View>
                <View style={styles.headerControls}>
                    <TouchableOpacity
                        style={[styles.viewModeButton, { backgroundColor: theme.colors.surface }]}
                        onPress={() => navigation.navigate('Search')}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Search videos"
                    >
                        <Feather name="search" size={20} color={theme.colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.viewModeButton, { backgroundColor: theme.colors.surface }]}
                        onPress={toggleViewMode}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                    >
                        <Feather name={viewMode === 'grid' ? 'list' : 'grid'} size={20} color={theme.colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.viewModeButton, { backgroundColor: theme.colors.surface }]}
                        onPress={toggleTheme}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={settings.darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        <Feather
                            name={settings.darkMode ? 'sun' : 'moon'}
                            size={20}
                            color={theme.colors.text}
                        />
                    </TouchableOpacity>
                </View>
            </View>
        ),
        [theme.colors, viewMode, sortedHistory.length, toggleViewMode, settings.darkMode, toggleTheme]
    );

    const renderSortBar = useCallback(
        () => (
            <View style={styles.sortBarContainer}>
                <View style={[styles.sortBar]}>
                    <Animated.View
                        style={[
                            {
                                position: 'absolute',
                                top: 0,
                                bottom: 0,
                                backgroundColor: theme.colors.surfaceVariant,
                                borderRadius: 20,
                                left: 0,
                                shadowColor: '#000',
                                shadowOffset: { width: 0, height: 1 },
                                shadowOpacity: 0.05,
                                shadowRadius: 2,
                                elevation: 1,
                                borderWidth: 1,
                                borderColor: theme.colors.border,
                            },
                            animatedIndicatorStyle,
                        ]}
                    />
                    {(['recent', 'views', 'name'] as const).map((sort) => (
                        <TouchableOpacity
                            key={sort}
                            style={styles.sortButton}
                            onPress={() => handleSortChange(sort)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={`Sort by ${sort}`}
                            onLayout={(event) => {
                                const { x, width } = event.nativeEvent.layout;
                                buttonLayouts.current[sort] = { x, width };
                                if (sortBy === sort) {
                                    // Use same timing or direct set if already measured, trying to match FoldersScreen logic
                                    indicatorLeft.value = withTiming(x, { duration: 250 });
                                    indicatorWidth.value = withTiming(width, { duration: 250 });
                                }
                            }}
                        >
                            <Feather
                                name={sort === 'recent' ? 'clock' : sort === 'views' ? 'eye' : 'file-text'}
                                size={14}
                                color={sortBy === sort ? theme.colors.text : theme.colors.textSecondary}
                            />
                            <Text
                                style={[
                                    styles.sortButtonText,
                                    {
                                        color: sortBy === sort ? theme.colors.text : theme.colors.textSecondary,
                                    },
                                ]}
                            >
                                {sort === 'recent' ? 'Recent' : sort === 'views' ? 'Views' : 'Name'}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>
        ),
        [sortBy, theme.colors, handleSortChange, animatedIndicatorStyle]
    );

    const renderEmpty = useCallback(
        () => (
            <View style={styles.emptyContainer}>
                <Feather name="clock" size={64} color={theme.colors.textSecondary} />
                <Text style={[styles.emptyText, { color: theme.colors.text }]}>No recently watched videos</Text>
                <Text style={[styles.emptySubtext, { color: theme.colors.textSecondary }]}>
                    Videos you watch will appear here
                </Text>
            </View>
        ),
        [theme.colors]
    );

    const renderItem = useCallback(
        ({ item }: { item: SectionItem }) => {
            if (!item.data && (!item.videos || !item.videos.length)) return null;

            if (viewMode === 'list') {
                return (
                    <VideoListItem
                        item={item.data!}
                        onPress={() => handleVideoPress(item.data!)}
                        onMorePress={() => handleOpenOptions(item.data!)}
                        theme={theme}
                    />
                );
            }

            return <GridRow item={item} onPress={handleVideoPress} onLongPress={handleOpenOptions} theme={theme} />;
        },
        [viewMode, theme]
    );

    if (loading && !refreshing) {
        return <Loader />;
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
            {renderHeader()}
            {renderSortBar()}
            <View style={{ flex: 1 }}>
                <FlatList
                    data={flattenedData}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    ListEmptyComponent={renderEmpty}
                    contentContainerStyle={
                        flattenedData.length === 0
                            ? styles.emptyListContainer
                            : [styles.listContent, viewMode === 'grid' && styles.gridListContent]
                    }
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            tintColor={theme.colors.primary}
                            colors={[theme.colors.primary]}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={true}
                    maxToRenderPerBatch={6}
                    initialNumToRender={10}
                    windowSize={5}
                />
                {/* Options Modals */}
                <VideoOptionsBottomSheet
                    visible={optionsVisible}
                    video={selectedVideo}
                    onClose={() => setOptionsVisible(false)}
                    onPlay={() => selectedVideo && handleVideoPress(selectedVideo as HistoryItemData)}
                    onShare={handleShare}
                    onDelete={handleDelete}
                    onClearHistory={handleClearHistoryItem}
                />
            </View>

        </View>
    );
}

// ... styles remain mostly same, just added moreButton style

const styles = StyleSheet.create({
    container: { flex: 1 },
    listContent: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 100,
    },
    gridListContent: {
        paddingHorizontal: GRID_SPACING, // 12
    },
    emptyListContainer: { flexGrow: 1 },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 30,
        paddingTop: 26,
        paddingBottom: 26,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 14,
        marginTop: 2,
        fontWeight: '500',
    },
    headerControls: {
        flexDirection: 'row',
        gap: 12,
    },
    viewModeButton: {
        width: 42,
        height: 42,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    sortBarContainer: {
        paddingHorizontal: 20,
        marginBottom: 16,
    },
    sortBar: {
        flexDirection: 'row',
        borderRadius: 14,
        position: 'relative',
    },
    sortButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        borderRadius: 10,
        zIndex: 1,
    },
    sortButtonText: {
        fontSize: 13,
        fontWeight: '600',
    },
    gridRow: {
        flexDirection: 'row',
        marginBottom: GRID_SPACING, // Use GRID_SPACING
        // Removed gap: 12 because we're handling spacing via item margins/width logic or just gap
        // FoldersScreen uses direct margin on items, but here we have a row wrapper.
        // Let's emulate FoldersScreen: FoldersScreen has NO row wrapper in the list itself, it uses numColumns=2.
        // But RecentsScreen uses 'gridRow' items in a single column list.
        // So we should mimic the spacing "gap" behavior.
        justifyContent: 'space-between',
        paddingHorizontal: 0,
    },
    videoGridCard: {
        // flex: 1, // Remove flex: 1 to respect fixed width
        width: GRID_ITEM_WIDTH,
        borderRadius: 16,
        overflow: 'hidden',
        height: GRID_ITEM_HEIGHT,
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        margin: 0, // Reset margin
    },
    videoGridThumbnail: {
        flex: 1, // This needs to take up available height minus info section
        width: '100%',
        position: 'relative',
        backgroundColor: '#eee', // Temporary placeholder color or theme.colors.surfaceVariant
    },
    videoGridThumbnailImage: { width: '100%', height: '100%' },
    thumbnailPlaceholder: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    playOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    bookmarkBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    bookmarkBadgeText: { fontSize: 10, fontWeight: 'bold' },
    progressBarContainer: {
        position: 'absolute',
        bottom: 12,
        left: 12,
        right: 12,
        height: 4, // Track height
        justifyContent: 'center',
    },
    progressBarContainerListWrapper: {
        marginTop: 0,
        marginHorizontal: 12,
        marginBottom: 12,
        zIndex: 10,
        height: 24, // Reserve space for time float
        justifyContent: 'flex-end', // Align slider to bottom
    },
    progressBarContainerList: {
        height: 4,
        justifyContent: 'center',
        position: 'relative', // Context for absolute children
        overflow: 'visible', // Allow time float to pop out
    },
    progressBarTrack: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        borderRadius: 2,
    },
    progressBar: {
        height: '100%',
        borderRadius: 2,
        position: 'absolute',
        left: 0,
    },
    sliderKnob: {
        position: 'absolute',
        width: 8, // 4px visual + 2px border on each side = 8px total width
        height: 16, // Taller than track
        borderRadius: 4,
        marginLeft: -4, // Center on end (8/2)
        top: -6, // Center vertically (16 - 4) / 2 = 6 up
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 1,
    },
    timeFloatContainer: {
        position: 'absolute',
        top: -22, // Float above track (knob is -6 top, 16 height -> top at -6, bottom at 10. Track is 0-4. )
        alignItems: 'center',
        width: 100, // Wide enough container
        marginLeft: -50, // Center on the point
    },
    timeFloatBubble: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 1,
    },
    timeFloatText: {
        fontSize: 10,
        fontWeight: 'bold',
    },
    timeText: {
        fontSize: 10,
        fontWeight: '500',
    },
    videoGridInfo: { padding: 12 },
    videoGridName: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
    metadataRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    metadataItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metadataText: { fontSize: 12 },
    videoItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        marginBottom: 4, // Reduce bottom margin since we adding slider below
        borderRadius: 16,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    videoThumbnail: {
        width: 64,
        height: 64,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
        overflow: 'hidden',
    },
    videoThumbnailImage: { width: '100%', height: '100%' },
    // playBadge removed/commented out in render
    playBadge: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 8,
        padding: 4,
    },
    videoInfo: {
        flex: 1,
        gap: 4,
    },
    videoName: {
        fontSize: 16,
        fontWeight: '600',
    },
    videoMetadata: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    metadataItemList: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    videoSize: {
        fontSize: 13,
    },
    moreButton: {
        padding: 8,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
        marginTop: 64,
    },
    emptyText: { fontSize: 18, fontWeight: 'bold', marginTop: 16, marginBottom: 8 },
    emptySubtext: { fontSize: 14, textAlign: 'center' },
});
