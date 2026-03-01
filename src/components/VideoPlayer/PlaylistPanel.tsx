import React, { useMemo, memo, useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Image, FlatList } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { Feather } from '@react-native-vector-icons/feather';
import { VideoFile } from '@/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAlbumVideos } from '@/hooks/useMediaService';
import { useThumbnail } from '@/hooks/useThumbnails';
import FastImage from 'react-native-fast-image';

interface PlaylistPanelProps {
    visible: boolean;
    onClose: () => void;
    currentVideoPath: string;
    onPlayVideo: (video: VideoFile) => void;
    isLandscape: boolean;
    albumName?: string;
}

// Memoized playlist item component
const PlaylistItem = memo<{
    item: VideoFile;
    isCurrent: boolean;
    onPlay: (video: VideoFile) => void;
}>(({ item, isCurrent, onPlay }) => {
    const { thumbnail } = useThumbnail(item.path, item.duration ? item.duration / 1000 : 0);

    const handlePlay = useCallback(() => {
        onPlay(item);
    }, [item, onPlay]);

    const formatDuration = (ms: number): string => {
        if (!ms) {return '';}
        const seconds = Math.floor(ms / 1000);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    return (
        <Pressable
            onPress={handlePlay}
            style={({ pressed }) => [
                styles.videoItem,
                isCurrent && styles.videoItemActive,
                pressed && styles.videoItemPressed,
            ]}
        >
            <View style={styles.videoMain}>
                <View style={styles.thumbnailContainer}>
                    {thumbnail ? (
                        <FastImage
                            source={{ uri: thumbnail }}
                            style={styles.thumbnail}
                            resizeMode={FastImage.resizeMode.cover}
                        />
                    ) : (
                        <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                            <Feather name="video" size={24} color="#666666" />
                        </View>
                    )}
                    {isCurrent && (
                        <View style={styles.playingOverlay}>
                            <Feather name="play" size={18} color="#FFFFFF" />
                        </View>
                    )}
                </View>

                <View style={styles.videoInfo}>
                    <Text
                        style={[styles.videoTitle, isCurrent && styles.videoTitleActive]}
                        numberOfLines={2}
                        ellipsizeMode="tail"
                    >
                        {item.name}
                    </Text>
                    {(item as any).duration > 0 && (
                        <Text style={styles.videoDuration}>
                            {formatDuration((item as any).duration)}
                        </Text>
                    )}
                </View>
            </View>
        </Pressable>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.item.path === nextProps.item.path &&
        prevProps.isCurrent === nextProps.isCurrent &&
        prevProps.onPlay === nextProps.onPlay
    );
});

PlaylistItem.displayName = 'PlaylistItem';

export const PlaylistPanel: React.FC<PlaylistPanelProps> = memo(({
    visible,
    onClose,
    currentVideoPath,
    onPlayVideo,
    albumName,
}) => {
    // Use the hook to fetch videos for the album
    const { videos, loading } = useAlbumVideos(albumName || null);

    // If no album name, we might want to just show the current video or nothing
    // For now, let's default to showing the videos if we found them

    const animationProgress = useSharedValue(visible ? 1 : 0);
    const insets = useSafeAreaInsets();

    useEffect(() => {
        animationProgress.value = withTiming(visible ? 1 : 0, {
            duration: 250,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        });
    }, [visible, animationProgress]);

    const panelStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: (1 - animationProgress.value) * 320 }],
    }));

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: animationProgress.value * 0.85,
        pointerEvents: (visible ? 'auto' : 'none') as any,
    }));

    const handlePlayAndClose = useCallback((video: VideoFile) => {
        onPlayVideo(video);
        onClose();
    }, [onPlayVideo, onClose]);

    return (
        <>
            {/* Backdrop */}
            <Animated.View style={[styles.backdrop, backdropStyle]}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
            </Animated.View>

            {/* Panel */}
            <Animated.View style={[styles.panel, panelStyle, { paddingTop: insets.top }]}>
                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.headerLeft}>
                        <View style={styles.iconContainer}>
                            <Feather name="list" size={20} color="#CCCCCC" />
                        </View>
                        <Text style={styles.headerTitle}>Playlist</Text>
                    </View>
                    <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
                        <Feather name="x" size={22} color="#808080" />
                    </Pressable>
                </View>

                {/* Video Count */}
                {videos.length > 0 && (
                    <View style={styles.countContainer}>
                        <Text style={styles.countText}>
                            {videos.length} {videos.length === 1 ? 'video' : 'videos'}
                        </Text>
                    </View>
                )}

                {/* Video List */}
                <FlatList
                    data={videos}
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={true}
                    initialNumToRender={10}
                    maxToRenderPerBatch={5}
                    windowSize={5}
                    keyExtractor={(item) => item.path}
                    renderItem={({ item }) => (
                        <PlaylistItem
                            item={item}
                            isCurrent={item.path === currentVideoPath}
                            onPlay={handlePlayAndClose}
                        />
                    )}
                    ListEmptyComponent={() => (
                        <View style={styles.emptyState}>
                            <View style={styles.emptyIconContainer}>
                                <Feather name="video" size={48} color="#1A1A1A" />
                            </View>
                            <Text style={styles.emptyText}>
                                {loading ? 'Loading...' : 'No videos'}
                            </Text>
                            <Text style={styles.emptySubtext}>
                                {loading ? 'Fetching playlist...' : 'This playlist is empty'}
                            </Text>
                        </View>
                    )}
                />
            </Animated.View>
        </>
    );
}, (prevProps, nextProps) => {
    if (prevProps.visible !== nextProps.visible) {return false;}
    if (prevProps.currentVideoPath !== nextProps.currentVideoPath) {return false;}
    if (prevProps.onPlayVideo !== nextProps.onPlayVideo) {return false;}
    if (prevProps.albumName !== nextProps.albumName) {return false;}
    return true;
});

PlaylistPanel.displayName = 'PlaylistPanel';

const styles = StyleSheet.create({
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#000000',
        zIndex: 100,
    },
    panel: {
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        backgroundColor: '#0A0A0A',
        zIndex: 101,
        shadowColor: '#000000',
        shadowOffset: { width: -4, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 16,
        elevation: 12,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#1A1A1A',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: '#0F0F0F',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        color: '#CCCCCC',
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    closeButton: {
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: '#0F0F0F',
        alignItems: 'center',
        justifyContent: 'center',
    },
    countContainer: {
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#1A1A1A',
    },
    countText: {
        color: '#808080',
        fontSize: 13,
        fontWeight: '500',
        letterSpacing: 0.2,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 24,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 80,
        paddingHorizontal: 32,
    },
    emptyIconContainer: {
        width: 96,
        height: 96,
        borderRadius: 48,
        backgroundColor: '#0F0F0F',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    emptyText: {
        color: '#CCCCCC',
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 8,
        letterSpacing: 0.2,
    },
    emptySubtext: {
        color: '#666666',
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
        letterSpacing: 0.1,
    },
    videoItem: {
        backgroundColor: '#121212',
        borderRadius: 14,
        marginBottom: 10,
        borderWidth: 1.5,
        borderColor: '#1A1A1A',
        overflow: 'hidden',
    },
    videoItemActive: {
        backgroundColor: '#1A1A1A',
        borderColor: '#cccccc50',
    },
    videoItemPressed: {
        opacity: 0.7,
        transform: [{ scale: 0.98 }],
    },
    videoMain: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        gap: 12,
    },
    thumbnailContainer: {
        width: 90,
        height: 50,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#0F0F0F',
    },
    thumbnail: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    thumbnailPlaceholder: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0F0F0F',
    },
    playingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    videoInfo: {
        flex: 1,
        gap: 4,
    },
    videoTitle: {
        color: '#CCCCCC',
        fontSize: 14,
        fontWeight: '500',
        letterSpacing: 0.1,
        lineHeight: 18,
    },
    videoTitleActive: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    videoDuration: {
        color: '#666666',
        fontSize: 12,
        fontVariant: ['tabular-nums'],
    },
});
