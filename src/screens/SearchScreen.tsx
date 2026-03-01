// src/screens/SearchScreen.tsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TextInput,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Dimensions,
    RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import FastImage from 'react-native-fast-image';
import Feather from '@react-native-vector-icons/feather';
import Animated, { FadeInDown, ZoomInRight } from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';
import { useVideoSearch } from '@/hooks/useVideoSearch';
import { useThumbnail } from '@/hooks/useThumbnails';
import { NavigationService } from '@/services/NavigationService';
import { VideoFile, RootStackParamList } from '@/types';
import { formatFileSize, formatDuration } from '@/utils/formatUtils';
import { Theme } from '@/theme/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_SPACING = 12;
const GRID_COLUMNS = 2;
const GRID_ITEM_WIDTH = (SCREEN_WIDTH - (GRID_SPACING * (GRID_COLUMNS + 1))) / GRID_COLUMNS;

type ViewMode = 'grid' | 'list';

// ============= THUMBNAIL COMPONENT =============

const VideoThumbnail = React.memo(({ path, duration }: { path: string; duration: number }) => {
    const { thumbnail } = useThumbnail(path, duration * 1000);
    const theme = useTheme();

    if (thumbnail) {
        return (
            <FastImage
                source={{ uri: thumbnail, priority: FastImage.priority.normal }}
                style={styles.thumbnailImage}
                resizeMode={FastImage.resizeMode.cover}
            />
        );
    }

    return (
        <View style={[styles.thumbnailPlaceholder, { backgroundColor: theme.colors.border }]}>
            <Feather name="video" size={24} color={theme.colors.textSecondary} />
        </View>
    );
});
VideoThumbnail.displayName = 'VideoThumbnail';

// ============= VIDEO GRID CARD =============

const SearchVideoGridCard = React.memo(({
    item,
    onPress,
    onLongPress,
    theme,
}: {
    item: VideoFile;
    onPress: () => void;
    onLongPress: () => void;
    theme: Theme;
}) => {
    return (
        <Animated.View entering={ZoomInRight.duration(250).springify().damping(30).mass(1).stiffness(200)}>
            <TouchableOpacity
                onPress={onPress}
                onLongPress={onLongPress}
                activeOpacity={0.7}
                style={[styles.videoGridCard, { backgroundColor: theme.colors.surface }]}
                accessibilityRole="button"
                accessibilityLabel={`Play video: ${item.name}`}
            >
                <View style={[styles.videoGridThumbnail, { backgroundColor: theme.colors.border }]}>
                    <VideoThumbnail path={item.path} duration={item.duration} />
                    <View style={styles.playOverlay}>
                        <Feather name="play" size={28} color="#FFFFFF" />
                    </View>
                    <View style={[styles.durationBadge, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
                        <Text style={styles.durationText}>{formatDuration(item.duration)}</Text>
                    </View>
                </View>
                <View style={styles.videoGridInfo}>
                    <Text style={[styles.videoGridName, { color: theme.colors.text }]} numberOfLines={2}>
                        {item.name}
                    </Text>
                    <Text style={[styles.videoGridSize, { color: theme.colors.textSecondary }]}>
                        {formatFileSize(item.size)} • {item.album}
                    </Text>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );
});
SearchVideoGridCard.displayName = 'SearchVideoGridCard';

// ============= VIDEO LIST ITEM =============

const SearchVideoListItem = React.memo(({
    item,
    onPress,
    onLongPress,
    theme,
}: {
    item: VideoFile;
    onPress: () => void;
    onLongPress: () => void;
    theme: Theme;
}) => {
    return (
        <Animated.View entering={FadeInDown.duration(400).springify().damping(20).mass(1).stiffness(150)}>
            <TouchableOpacity
                style={[styles.videoListItem, { backgroundColor: theme.colors.background, borderColor: theme.colors.surface, borderWidth: 2 }]}
                onPress={onPress}
                onLongPress={onLongPress}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Play video: ${item.name}`}
            >
                <View style={[styles.videoThumbnail, { backgroundColor: theme.colors.surfaceVariant }]}>
                    <VideoThumbnail path={item.path} duration={item.duration} />
                </View>
                <View style={styles.videoInfo}>
                    <Text style={[styles.videoName, { color: theme.colors.text }]} numberOfLines={1}>
                        {item.name}
                    </Text>
                    <Text style={[styles.videoMeta, { color: theme.colors.textSecondary }]}>
                        {formatDuration(item.duration)} • {formatFileSize(item.size)}
                    </Text>
                    <Text style={[styles.videoAlbum, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {item.album}
                    </Text>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );
});
SearchVideoListItem.displayName = 'SearchVideoListItem';

// ============= MAIN COMPONENT =============

export default function SearchScreen() {
    const theme = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const insets = useSafeAreaInsets();
    const inputRef = useRef<TextInput>(null);

    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [refreshing, setRefreshing] = useState(false);

    const {
        query,
        setQuery,
        results,
        isIndexReady,
        isIndexing,
        indexProgress,
        clearSearch,
        forceRefresh,
    } = useVideoSearch();

    // Auto-focus search input when index is ready
    useEffect(() => {
        if (isIndexReady && inputRef.current) {
            // Small delay to ensure smooth transition
            const timer = setTimeout(() => {
                inputRef.current?.focus();
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isIndexReady]);

    const handleVideoPress = useCallback((video: VideoFile) => {
        NavigationService.handleVideoNavigation(navigation, video.path, {
            videoName: video.name,
            contentUri: video.uri,
            albumName: video.album,
        });
    }, [navigation]);

    const handleVideoLongPress = useCallback((video: VideoFile) => {
        // TODO: Implement options bottom sheet
        if (__DEV__) {console.log('Long press:', video.name);}
    }, []);

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        await forceRefresh();
        setRefreshing(false);
    }, [forceRefresh]);

    const toggleViewMode = useCallback(() => {
        setViewMode(prev => prev === 'grid' ? 'list' : 'grid');
    }, []);

    // ============= HELPER FUNCTIONS & HOOKS =============

    const renderHeader = () => (
        <View style={styles.header}>
            <View style={styles.titleRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <TouchableOpacity
                        onPress={() => navigation.goBack()}
                        style={{ padding: 4, marginLeft: -4 }}
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                    >
                        <Feather name="arrow-left" size={26} color={theme.colors.text} />
                    </TouchableOpacity>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                        <Text style={[styles.title, { color: theme.colors.text }]}>Search</Text>
                        {results.length > 0 && (
                            <Text style={[styles.resultCount, { color: theme.colors.textSecondary }]}>
                                {results.length} video{results.length !== 1 ? 's' : ''}
                            </Text>
                        )}
                    </View>
                </View>
                <TouchableOpacity
                    style={[styles.viewModeButton, { backgroundColor: theme.colors.surface }]}
                    onPress={toggleViewMode}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                >
                    <Feather name={viewMode === 'grid' ? 'list' : 'grid'} size={20} color={theme.colors.text} />
                </TouchableOpacity>
            </View>

            <View style={[styles.searchInputContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Feather name="search" size={20} color={theme.colors.textSecondary} />
                <TextInput
                    ref={inputRef}
                    style={[styles.searchInput, { color: theme.colors.text }]}
                    placeholder="Search videos by name..."
                    placeholderTextColor={theme.colors.textSecondary}
                    value={query}
                    onChangeText={setQuery}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="search"
                />
                {query.length > 0 && (
                    <TouchableOpacity onPress={clearSearch} hitSlop={10}>
                        <Feather name="x-circle" size={20} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                )}
            </View>

        </View>
    );

    const renderEmptySearch = () => (
        <View style={styles.emptyContainer}>
            <Feather name="search" size={64} color={theme.colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                Search for videos
            </Text>
            <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
                Type a video name to search across all your folders
            </Text>
        </View>
    );

    const renderNoResults = () => (
        <View style={styles.emptyContainer}>
            <Feather name="video-off" size={64} color={theme.colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                No videos found
            </Text>
            <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
                No videos matching "{query}"
            </Text>
        </View>
    );

    const renderItem = useCallback(({ item }: { item: VideoFile }) => {
        if (viewMode === 'list') {
            return (
                <SearchVideoListItem
                    item={item}
                    onPress={() => handleVideoPress(item)}
                    onLongPress={() => handleVideoLongPress(item)}
                    theme={theme}
                />
            );
        }
        return (
            <SearchVideoGridCard
                item={item}
                onPress={() => handleVideoPress(item)}
                onLongPress={() => handleVideoLongPress(item)}
                theme={theme}
            />
        );
    }, [viewMode, theme, handleVideoPress, handleVideoLongPress]);

    const keyExtractor = useCallback((item: VideoFile) => item.path, []);

    const getEmptyComponent = () => {
        if (!query.trim()) {
            return renderEmptySearch();
        }
        return renderNoResults();
    };

    // ============= RENDER INDEXING STATE =============

    if (!isIndexReady) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
                <View style={styles.indexingContainer}>
                    <ActivityIndicator size="large" color={theme.colors.primary} />
                    <Text style={[styles.indexingTitle, { color: theme.colors.text }]}>
                        Preparing search...
                    </Text>
                    {indexProgress && (
                        <Text style={[styles.indexingProgress, { color: theme.colors.textSecondary }]}>
                            {indexProgress.scanned.toLocaleString()} / {indexProgress.total.toLocaleString()} videos
                        </Text>
                    )}
                    <View style={[styles.progressBarContainer, { backgroundColor: theme.colors.border }]}>
                        <View
                            style={[
                                styles.progressBar,
                                {
                                    backgroundColor: theme.colors.primary,
                                    width: indexProgress && indexProgress.total > 0
                                        ? `${(indexProgress.scanned / indexProgress.total) * 100}%`
                                        : '0%',
                                },
                            ]}
                        />
                    </View>
                </View>
            </View>
        );
    }

    // ============= RENDER SEARCH UI =============

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
            {renderHeader()}
            <FlatList
                data={results}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                ListEmptyComponent={getEmptyComponent}
                contentContainerStyle={[
                    styles.listContent,
                    results.length === 0 && styles.emptyListContent,
                    viewMode === 'grid' && styles.gridListContent,
                    { paddingBottom: insets.bottom + 20 },
                ]}
                numColumns={viewMode === 'grid' ? GRID_COLUMNS : 1}
                key={viewMode} // Force re-render when switching view modes
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={theme.colors.primary}
                        colors={[theme.colors.primary]}
                    />
                }
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                removeClippedSubviews={true}
                maxToRenderPerBatch={10}
                initialNumToRender={12}
                windowSize={5}
            />
        </View>
    );
}

// ============= STYLES =============

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 12,
    },
    titleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 16,
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
    },
    resultCount: {
        fontSize: 14,
        fontWeight: '500',
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 8,
        paddingVertical: 12,
        borderRadius: 16,
        borderWidth: 1,
        gap: 12,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        padding: 0,
    },
    controlsRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 12,
    },
    viewModeButton: {
        padding: 10,
        borderRadius: 12,
    },
    listContent: {
        paddingHorizontal: 20,
    },
    gridListContent: {
        paddingHorizontal: GRID_SPACING,
    },
    emptyListContent: {
        flexGrow: 1,
        justifyContent: 'center',
    },

    // Indexing state
    indexingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    indexingTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginTop: 24,
        marginBottom: 8,
    },
    indexingProgress: {
        fontSize: 14,
        marginBottom: 24,
    },
    progressBarContainer: {
        height: 4,
        width: '60%',
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressBar: {
        height: '100%',
        borderRadius: 2,
    },

    // Empty states
    emptyContainer: {
        alignItems: 'center',
        padding: 32,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginTop: 24,
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 14,
        textAlign: 'center',
    },

    // Thumbnail
    thumbnailImage: {
        width: '100%',
        height: '100%',
    },
    thumbnailPlaceholder: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Grid card
    videoGridCard: {
        width: GRID_ITEM_WIDTH,
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: GRID_SPACING,
        marginHorizontal: GRID_SPACING / 2,
    },
    videoGridThumbnail: {
        width: '100%',
        aspectRatio: 16 / 9,
        position: 'relative',
    },
    videoGridInfo: {
        padding: 12,
    },
    videoGridName: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 4,
    },
    videoGridSize: {
        fontSize: 12,
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
    durationBadge: {
        position: 'absolute',
        bottom: 8,
        right: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    durationText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '600',
    },

    // List item
    videoListItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        marginBottom: 12,
        borderRadius: 16,
        elevation: 2,
    },
    videoThumbnail: {
        width: 100,
        height: 60,
        borderRadius: 8,
        overflow: 'hidden',
    },
    videoInfo: {
        flex: 1,
        marginLeft: 12,
    },
    videoName: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 4,
    },
    videoMeta: {
        fontSize: 12,
        marginBottom: 2,
    },
    videoAlbum: {
        fontSize: 12,
    },
});


