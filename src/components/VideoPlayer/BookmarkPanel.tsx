// components/VideoPlayer/BookmarkPanel.tsx
import React, { useMemo, memo, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { Feather } from '@react-native-vector-icons/feather';
import { VideoBookmark } from '@/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface BookmarkPanelProps {
    visible: boolean;
    bookmarks: VideoBookmark[];
    currentTime: number;
    onClose: () => void;
    onSelectBookmark: (timestamp: number) => void;
    onDeleteBookmark: (bookmarkId: string) => void;
    formatTime: (seconds: number) => string;
}

// Memoized bookmark item component
const BookmarkItem = memo<{
    bookmark: VideoBookmark;
    index: number;
    isActive: boolean;
    onSelect: (timestamp: number) => void;
    onDelete: (bookmarkId: string) => void;
    formatTime: (seconds: number) => string;
}>(({ bookmark, index, isActive, onSelect, onDelete, formatTime }) => {
    const handleSelect = useCallback(() => {
        onSelect(bookmark.timestamp);
    }, [bookmark.timestamp, onSelect]);

    const handleDelete = useCallback(() => {
        onDelete(bookmark.id);
    }, [bookmark.id, onDelete]);

    return (
        <Pressable
            onPress={handleSelect}
            style={({ pressed }) => [
                styles.bookmarkItem,
                isActive && styles.bookmarkItemActive,
                pressed && styles.bookmarkItemPressed,
            ]}
        >
            <View style={styles.bookmarkMain}>
                <View style={styles.bookmarkLeft}>
                    <View style={[styles.indexBadge, isActive && styles.indexBadgeActive]}>
                        <Text style={[styles.indexText, isActive && styles.indexTextActive]}>
                            {index + 1}
                        </Text>
                    </View>
                    <View style={styles.bookmarkInfo}>
                        <Text style={[styles.bookmarkTime, isActive && styles.bookmarkTimeActive]}>
                            {formatTime(bookmark.timestamp)}
                        </Text>
                        {bookmark.label && (
                            <Text
                                style={styles.bookmarkLabel}
                                numberOfLines={2}
                                ellipsizeMode="tail"
                            >
                                {bookmark.label}
                            </Text>
                        )}
                    </View>
                </View>

                <Pressable
                    onPress={handleDelete}
                    hitSlop={10}
                    style={({ pressed }) => [
                        styles.deleteButton,
                        pressed && styles.deleteButtonPressed,
                    ]}
                >
                    <Feather name="trash-2" size={18} color="#808080" />
                </Pressable>
            </View>
        </Pressable>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.bookmark.id === nextProps.bookmark.id &&
        prevProps.bookmark.timestamp === nextProps.bookmark.timestamp &&
        prevProps.bookmark.label === nextProps.bookmark.label &&
        prevProps.isActive === nextProps.isActive &&
        prevProps.index === nextProps.index &&
        prevProps.onSelect === nextProps.onSelect && // NEW: Check for callback updates
        prevProps.onDelete === nextProps.onDelete // NEW: Check for callback updates
    );
});

BookmarkItem.displayName = 'BookmarkItem';

export const BookmarkPanel: React.FC<BookmarkPanelProps> = memo(({
    visible,
    bookmarks,
    currentTime,
    onClose,
    onSelectBookmark,
    onDeleteBookmark,
    formatTime,
}) => {
    const animationProgress = useSharedValue(visible ? 1 : 0);

    const insets = useSafeAreaInsets()

    React.useEffect(() => {
        animationProgress.value = withTiming(visible ? 1 : 0, {
            duration: 250, // Reduced from 300ms
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

    const sortedBookmarks = useMemo(() => {
        return [...bookmarks].sort((a, b) => a.timestamp - b.timestamp);
    }, [bookmarks]);

    const handleSelectAndClose = useCallback((timestamp: number) => {
        onSelectBookmark(timestamp);
        onClose();
    }, [onSelectBookmark, onClose]);

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
                            <Feather name="bookmark" size={20} color="#CCCCCC" />
                        </View>
                        <Text style={styles.headerTitle}>Bookmarks</Text>
                    </View>
                    <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
                        <Feather name="x" size={22} color="#808080" />
                    </Pressable>
                </View>

                {/* Bookmark Count */}
                {sortedBookmarks.length > 0 && (
                    <View style={styles.countContainer}>
                        <Text style={styles.countText}>
                            {sortedBookmarks.length} {sortedBookmarks.length === 1 ? 'bookmark' : 'bookmarks'}
                        </Text>
                    </View>
                )}

                {/* Bookmark List */}
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={true}
                >
                    {sortedBookmarks.length === 0 ? (
                        <View style={styles.emptyState}>
                            <View style={styles.emptyIconContainer}>
                                <Feather name="bookmark" size={48} color="#1A1A1A" />
                            </View>
                            <Text style={styles.emptyText}>No bookmarks yet</Text>
                            <Text style={styles.emptySubtext}>
                                Tap the bookmark icon while watching to save your favorite moments
                            </Text>
                        </View>
                    ) : (
                        sortedBookmarks.map((bookmark, index) => {
                            const isActive = Math.abs(currentTime - bookmark.timestamp) < 2;
                            return (
                                <BookmarkItem
                                    key={bookmark.id}
                                    bookmark={bookmark}
                                    index={index}
                                    isActive={isActive}
                                    onSelect={handleSelectAndClose}
                                    onDelete={onDeleteBookmark}
                                    formatTime={formatTime}
                                />
                            );
                        })
                    )}
                </ScrollView>
            </Animated.View>
        </>
    );
}, (prevProps, nextProps) => {
    // Optimize re-renders - only update when necessary
    if (prevProps.visible !== nextProps.visible) return false;
    if (prevProps.bookmarks.length !== nextProps.bookmarks.length) return false;
    if (prevProps.onSelectBookmark !== nextProps.onSelectBookmark) return false; // NEW: Check for callback updates
    if (Math.abs(prevProps.currentTime - nextProps.currentTime) < 1) return true; // Skip minor time updates
    return false;
});

BookmarkPanel.displayName = 'BookmarkPanel';

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
    bookmarkItem: {
        backgroundColor: '#121212',
        borderRadius: 14,
        marginBottom: 10,
        borderWidth: 1.5,
        borderColor: '#1A1A1A',
        overflow: 'hidden',
    },
    bookmarkItemActive: {
        backgroundColor: '#1A1A1A',
        borderColor: '#cccccc50',
    },
    bookmarkItemPressed: {
        opacity: 0.7,
        transform: [{ scale: 0.98 }],
    },
    bookmarkMain: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
    },
    bookmarkLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        gap: 12,
    },
    indexBadge: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: '#0F0F0F',
        alignItems: 'center',
        justifyContent: 'center',
    },
    indexBadgeActive: {
        backgroundColor: '#262626',
    },
    indexText: {
        color: '#666666',
        fontSize: 14,
        fontWeight: '600',
    },
    indexTextActive: {
        color: '#CCCCCC',
    },
    bookmarkInfo: {
        flex: 1,
        gap: 4,
    },
    bookmarkTime: {
        color: '#CCCCCC',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
        fontVariant: ['tabular-nums'],
    },
    bookmarkTimeActive: {
        color: '#FFFFFF',
    },
    bookmarkLabel: {
        color: '#666666',
        fontSize: 13,
        lineHeight: 18,
        letterSpacing: 0.1,
    },
    deleteButton: {
        width: 36,
        height: 36,
        borderRadius: 8,
        backgroundColor: '#0F0F0F',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
    },
    deleteButtonPressed: {
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
    },
});