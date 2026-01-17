import React, { useCallback, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    TouchableOpacity,
    Dimensions,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { FlashList as FlashListOriginal } from '@shopify/flash-list';
import FastImage from 'react-native-fast-image';
import Feather from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { ZoomIn, LinearTransition, FadeInRight, ZoomInRight, FadeInDown } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { RootStackParamList, VideoFile } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumVideos } from '@/hooks/useMediaService';
import { formatFileSize } from '@/utils/formatUtils';
import { useThumbnail } from '@/hooks/useThumbnails';
import { NavigationService } from '@/services/NavigationService';

const FlashList = Animated.createAnimatedComponent(FlashListOriginal) as any;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type AlbumVideosRouteProp = RouteProp<RootStackParamList, 'AlbumVideos'>;

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_ITEM_HEIGHT = 170; // 160 + margins
const LIST_ITEM_HEIGHT = 90; // 72 + margins
const PADDING = 20;

type ViewMode = 'grid' | 'list';

// ============= MEMOIZED COMPONENTS =============

const VideoThumbnail = React.memo(({ path, duration }: { path: string; duration: number }) => {
    const { thumbnail } = useThumbnail(path, duration);
    const theme = useTheme();

    if (thumbnail) {
        return (
            <FastImage
                source={{ uri: thumbnail, priority: FastImage.priority.high }}
                style={styles.videoThumbnailImage}
                resizeMode={FastImage.resizeMode.cover}
            />
        );
    }

    return (
        <View style={[styles.thumbnailPlaceholder, { backgroundColor: theme.colors.border }]}>
            <Feather name="video" size={20} color={theme.colors.textSecondary} />
        </View>
    );
});
VideoThumbnail.displayName = 'VideoThumbnail';

const VideoGridCard = React.memo(
    ({
        item,
        onPress,
        theme,
        index,
    }: {
        item: VideoFile;
        onPress: () => void;
        theme: any;
        index: number;
    }) => {
        return (
            <Animated.View
                entering={ZoomInRight.duration(250).springify().damping(30).mass(1).stiffness(200)}
                style={styles.gridItemContainer}
            >
                <TouchableOpacity
                    onPress={onPress}
                    activeOpacity={0.7}
                    style={[styles.videoGridCard, { backgroundColor: theme.colors.surface }]}
                >
                    <View style={[styles.videoGridThumbnail, { backgroundColor: theme.colors.surfaceVariant }]}>
                        <VideoThumbnail path={item.path} duration={item.duration} />
                        <View style={styles.playOverlay}>
                            <Feather name="play" size={24} color="#FFFFFF" />
                        </View>
                    </View>
                    <View style={styles.videoGridInfo}>
                        <Text style={[styles.videoGridName, { color: theme.colors.text }]} numberOfLines={2}>
                            {item.name}
                        </Text>
                        <Text style={[styles.videoGridSize, { color: theme.colors.textSecondary }]}>
                            {formatFileSize(item.size)}
                        </Text>
                    </View>
                </TouchableOpacity>
            </Animated.View>
        );
    }
);
VideoGridCard.displayName = 'VideoGridCard';

const VideoListItem = React.memo(({ item, onPress, theme, index }: any) => (
    <Animated.View
        entering={FadeInDown.duration(400).springify().damping(20).mass(1).stiffness(150)}
    >
        <TouchableOpacity
            style={[styles.videoListItem, { backgroundColor: theme.colors.background, borderColor: theme.colors.surface, borderWidth: 2, elevation: 5 }]}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <View style={[styles.videoThumbnail, { backgroundColor: theme.colors.surfaceVariant }]}>
                <VideoThumbnail path={item.path} duration={item.duration} />
            </View>
            <View style={styles.videoInfo}>
                <Text style={[styles.videoName, { color: theme.colors.text }]} numberOfLines={1}>
                    {item.name}
                </Text>
                <Text style={[styles.videoSize, { color: theme.colors.textSecondary }]}>
                    {formatFileSize(item.size)}
                </Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
        </TouchableOpacity>
    </Animated.View>
));
VideoListItem.displayName = 'VideoListItem';

// ============= MAIN COMPONENT =============

export default function AlbumVideosScreen() {
    const theme = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<AlbumVideosRouteProp>();
    const insets = useSafeAreaInsets();

    const { albumTitle } = route.params;
    const { videos, loading, loadingMore, hasMore, loadMore, refetch } = useAlbumVideos(albumTitle);
    const [viewMode, setViewMode] = useState<ViewMode>('list');

    const handleVideoPress = useCallback((video: VideoFile) => {
        NavigationService.handleVideoNavigation(navigation, video.path, {
            videoName: video.name,
            albumName: albumTitle,
        });
    }, [navigation, albumTitle]);

    const toggleViewMode = useCallback(() => {
        setViewMode((prev) => (prev === 'grid' ? 'list' : 'grid'));
    }, []);

    const renderItem = useCallback(
        ({ item, index }: { item: VideoFile, index: number }) => {
            if (viewMode === 'list') {
                return (
                    <VideoListItem
                        item={item}
                        onPress={() => handleVideoPress(item)}
                        theme={theme}
                        index={index}
                    />
                );
            }
            return <VideoGridCard item={item} onPress={() => handleVideoPress(item)} theme={theme} index={index} />;
        },
        [viewMode, theme, handleVideoPress]
    );

    const renderHeader = useCallback(() => (
        <View style={styles.header}>
            <TouchableOpacity
                style={[styles.backButton, { backgroundColor: theme.colors.surface }]}
                onPress={() => navigation.goBack()}
                activeOpacity={0.7}
            >
                <Feather name="arrow-left" size={20} color={theme.colors.text} />
            </TouchableOpacity>
            <View style={styles.headerInfo}>
                <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
                    {albumTitle}
                </Text>
                <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                    {videos.length} videos
                </Text>
            </View>
            <TouchableOpacity
                style={[styles.viewModeButton, { backgroundColor: theme.colors.surface }]}
                onPress={toggleViewMode}
                activeOpacity={0.7}
            >
                <Feather name={viewMode === 'grid' ? 'list' : 'grid'} size={20} color={theme.colors.text} />
            </TouchableOpacity>
        </View>
    ), [albumTitle, videos.length, navigation, theme, viewMode, toggleViewMode]);

    const renderFooter = useCallback(() => {
        if (!loadingMore) return <View style={{ height: 20 }} />;
        return (
            <View style={{ paddingVertical: 20 }}>
                <ActivityIndicator color={theme.colors.primary} />
            </View>
        );
    }, [loadingMore, theme.colors.primary]);

    const renderEmpty = useCallback(() => (
        <View style={styles.emptyContainer}>
            <Feather name="video-off" size={64} color={theme.colors.textSecondary} />
            <Text style={[styles.emptyText, { color: theme.colors.text }]}>No videos found</Text>
            <Text style={[styles.emptySubtext, { color: theme.colors.textSecondary }]}>
                This album appears to be empty
            </Text>
        </View>
    ), [theme]);

    if (loading && videos.length === 0) {
        return (
            <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
        );
    }

    return (
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
            <View style={[styles.container, { paddingTop: insets.top }]}>
                {renderHeader()}
                <View style={{ flex: 1 }}>
                    <FlashList
                        data={videos}
                        renderItem={renderItem}
                        estimatedItemSize={viewMode === 'grid' ? GRID_ITEM_HEIGHT : LIST_ITEM_HEIGHT}
                        ListEmptyComponent={renderEmpty}
                        ListFooterComponent={renderFooter}
                        onEndReachedThreshold={0.5}
                        onEndReached={() => {
                            if (hasMore) loadMore();
                        }}
                        keyExtractor={(item: VideoFile) => item.path}
                        numColumns={viewMode === 'grid' ? 2 : 1}
                        key={viewMode}
                        contentContainerStyle={
                            videos.length === 0
                                ? styles.emptyListContainer
                                : [styles.listContent, viewMode === 'grid' && styles.gridListContent]
                        }
                        showsVerticalScrollIndicator={false}
                        itemLayoutAnimation={LinearTransition.duration(200)}
                    />
                </View>
            </View>
        </GestureHandlerRootView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 16,
        gap: 16,
    },
    backButton: {
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
    headerInfo: {
        flex: 1,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 14,
        marginTop: 2,
    },
    listContent: {
        paddingHorizontal: 20,
        paddingBottom: 100,
        paddingTop: 8,
    },
    gridListContent: {
        paddingHorizontal: 15,
    },
    emptyListContainer: {
        flexGrow: 1,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
        marginTop: 64,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 16,
        marginBottom: 8,
    },
    emptySubtext: {
        fontSize: 14,
        textAlign: 'center',
    },
    // Grid styles
    gridItemContainer: {
        flex: 1,
        margin: 5,
        height: GRID_ITEM_HEIGHT,
    },
    videoGridCard: {
        flex: 1,
        borderRadius: 16,
        overflow: 'hidden',
        height: '100%',
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    videoGridThumbnail: {
        height: 100, // Reduced from 130
        width: '100%',
        position: 'relative',
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
    videoGridInfo: {
        padding: 10,
        flex: 1,
        justifyContent: 'space-between',
    },
    videoGridName: {
        fontSize: 13, // Reduced
        fontWeight: '600',
        lineHeight: 16,
    },
    videoGridSize: {
        fontSize: 11,
        marginTop: 4,
    },
    // List styles
    videoListItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 16,
        marginBottom: 12,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    videoThumbnail: {
        width: 64, // Standardize to 64
        height: 64,
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        marginRight: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    videoThumbnailImage: {
        width: '100%',
        height: '100%',
    },
    thumbnailPlaceholder: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    playBadge: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        backgroundColor: 'rgba(0,0,0,0.6)',
        width: 16,
        height: 16,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoInfo: {
        flex: 1,
        gap: 4,
    },
    videoName: {
        fontSize: 16,
        fontWeight: '600',
    },
    videoSize: {
        fontSize: 13,
    },
});
