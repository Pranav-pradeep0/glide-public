import React, {
    useState,
    useMemo,
    useCallback,
    useEffect,
    useRef,
} from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    RefreshControl,
    Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import FastImage from 'react-native-fast-image';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Feather from '@react-native-vector-icons/feather';
import { FlashList as FlashListOriginal } from '@shopify/flash-list';
import Animated, {
    withTiming,
    useAnimatedStyle,
    useSharedValue,
    FadeInDown,
    ZoomInRight,
    LinearTransition,
    Layout
} from 'react-native-reanimated';
import { Loader } from '@/components/Loader';

// Initialize AnimatedFlashList
const FlashList = Animated.createAnimatedComponent(FlashListOriginal) as any;

import { RootStackParamList } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore } from '@/store/appStore';
import { useAlbums, useAlbumVideos, useAlbumCover } from '@/hooks/useMediaService';
import { useThumbnail } from '@/hooks/useThumbnails';
import { Theme } from '@/theme/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_SPACING = 12;
const GRID_COLUMNS = 2;
// Calculate dynamic grid item width based on screen width
const GRID_ITEM_WIDTH = (SCREEN_WIDTH - (GRID_SPACING * (GRID_COLUMNS + 1))) / GRID_COLUMNS;
const GRID_ITEM_HEIGHT = GRID_ITEM_WIDTH * 1.1; // Slightly taller than wide
const LIST_ITEM_HEIGHT = 88;

interface AlbumWithCount {
    title: string;
    count: number;
}

type ViewMode = 'grid' | 'list';
type SortByOption = 'name' | 'count' | 'recent';

const AlbumThumbnail = React.memo(({ albumName }: { albumName: string }) => {
    const coverVideo = useAlbumCover(albumName);
    const firstVideoPath = coverVideo?.path;
    const { thumbnail } = useThumbnail(firstVideoPath);

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
        <Feather name="folder" size={42} color="#888888" />
    );
});

const AlbumGridCard = React.memo(({ item, onPress, theme, index }: any) => {
    return (
        <Animated.View
            // Use spring with high damping to eliminate bounce but keep movement
            entering={ZoomInRight.duration(250).springify().damping(30).mass(1).stiffness(200)}
            layout={LinearTransition.springify().damping(25).mass(1).stiffness(120)}
            style={[styles.gridItemContainer]}
        >
            <TouchableOpacity
                style={[styles.folderGridCard, { backgroundColor: theme.colors.surface }]}
                onPress={onPress}
                activeOpacity={0.7}
            >
                <View style={[styles.thumbnail, { backgroundColor: theme.colors.surfaceVariant }]}>
                    <AlbumThumbnail key={item.title} albumName={item.title} />
                    <View style={styles.gridCountBadge}>
                        <Feather name="video" size={10} color="#FFF" />
                        <Text style={styles.gridCountText}>{item.count}</Text>
                    </View>
                </View>
                <View style={styles.folderInfo}>
                    <Text style={[styles.folderName, { color: theme.colors.text }]} numberOfLines={1}>
                        {item.title}
                    </Text>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );
});

const AlbumListItem = React.memo(({ item, onPress, theme, index }: { item: any, onPress: any, theme: Theme, index: any }) => (
    <Animated.View
        entering={FadeInDown.duration(400).springify().damping(20).mass(1).stiffness(150)}
        layout={LinearTransition.springify().damping(25).mass(1).stiffness(120)}
    >
        <TouchableOpacity
            style={[styles.folderListItem, { backgroundColor: theme.colors.background, borderColor: theme.colors.surface, borderWidth: 2, elevation: 5 }]}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <View style={[styles.listThumbnail, { backgroundColor: theme.colors.surfaceVariant }]}>
                <AlbumThumbnail key={item.title} albumName={item.title} />
            </View>
            <View style={styles.listInfo}>
                <Text style={[styles.folderListName, { color: theme.colors.text }]} numberOfLines={1}>
                    {item.title}
                </Text>
                <Text style={[styles.listCount, { color: theme.colors.textSecondary }]}>
                    {item.count} video{item.count !== 1 ? 's' : ''}
                </Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
        </TouchableOpacity>
    </Animated.View>
));

export default function FoldersScreen() {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<NavigationProp>();
    const { settings, updateSettings } = useAppStore();

    const { albums, loading, refetch } = useAlbums();

    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [sortBy, setSortBy] = useState<SortByOption>('name');

    const flashListRef = useRef<any>(null);

    const indicatorLeft = useSharedValue(0);
    const indicatorWidth = useSharedValue(0);
    const buttonLayouts = useRef<{ [key in SortByOption]: { x: number; width: number } | null }>({
        name: null,
        count: null,
        recent: null,
    });

    const animatedIndicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: indicatorLeft.value }],
        width: indicatorWidth.value,
    }));

    useEffect(() => {
        // Scroll to top when sort changes - add small delay to ensure list has updated
        const scrollTimeout = setTimeout(() => {
            flashListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }, 100);

        // Need a small delay or check to ensure layouts are measured
        const layoutTimeout = setTimeout(() => {
            const layout = buttonLayouts.current[sortBy];
            if (layout) {
                indicatorLeft.value = withTiming(layout.x, { duration: 250 });
                indicatorWidth.value = withTiming(layout.width, { duration: 250 });
            }
        }, 100);
        return () => {
            clearTimeout(scrollTimeout);
            clearTimeout(layoutTimeout);
        };
    }, [sortBy]);

    const sortedAlbums = useMemo(() => {
        return [...albums].sort((a, b) => {
            if (sortBy === 'name') return a.title.localeCompare(b.title);
            if (sortBy === 'count') return b.count - a.count;
            // For 'recent', we don't have timestamp data, so fallback to name
            return a.title.localeCompare(b.title);
        });
    }, [albums, sortBy]);

    // Handlers
    const handleAlbumPress = useCallback((album: AlbumWithCount) => {
        navigation.navigate('AlbumVideos', {
            albumTitle: album.title,
            videoCount: album.count,
        });
    }, [navigation]);

    const toggleViewMode = useCallback(() => {
        setViewMode((prev) => (prev === 'grid' ? 'list' : 'grid'));
    }, []);

    const toggleTheme = useCallback(() => {
        updateSettings({ darkMode: !settings.darkMode });
    }, [settings.darkMode, updateSettings]);

    const handleSortChange = useCallback((newSort: SortByOption) => {
        setSortBy(newSort);
    }, []);

    const renderAlbum = useCallback(({ item, index }: { item: AlbumWithCount, index: number }) => {
        if (viewMode === 'grid') {
            return <AlbumGridCard key={item.title} item={item} onPress={() => handleAlbumPress(item)} theme={theme} index={index} />;
        }
        return <AlbumListItem key={item.title} item={item} onPress={() => handleAlbumPress(item)} theme={theme} index={index} />;
    }, [viewMode, theme, handleAlbumPress]);

    const renderHeaderMain = useCallback(() => (
        <View style={styles.header}>
            <View>
                <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Library</Text>
                <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                    {sortedAlbums.length} album{sortedAlbums.length !== 1 ? 's' : ''}
                </Text>
            </View>
            <View style={styles.headerActions}>
                <TouchableOpacity
                    style={[styles.viewModeButton, { backgroundColor: theme.colors.surface }]}
                    onPress={() => navigation.navigate('Search')}
                    activeOpacity={0.7}
                >
                    <Feather name="search" size={20} color={theme.colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.viewModeButton, { backgroundColor: theme.colors.surface }]}
                    onPress={toggleViewMode}
                    activeOpacity={0.7}
                >
                    <Feather name={viewMode === 'grid' ? 'list' : 'grid'} size={20} color={theme.colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.viewModeButton, { backgroundColor: theme.colors.surface }]}
                    onPress={toggleTheme}
                    activeOpacity={0.7}
                >
                    <Feather
                        name={settings.darkMode ? 'sun' : 'moon'}
                        size={20}
                        color={theme.colors.text}
                    />
                </TouchableOpacity>
            </View>
        </View>
    ), [theme.colors, viewMode, sortedAlbums.length, toggleViewMode, settings.darkMode, toggleTheme]);

    const renderSortBar = useCallback(() => (
        <View style={[styles.sortBarContainer]}>
            <View style={[styles.sortBar]}>
                <Animated.View
                    style={[
                        {
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            backgroundColor: theme.colors.surface,
                            borderRadius: 20, // More rounded
                            left: 0, // Base position, transformed by translateX
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.05, // Settle shadow
                            shadowRadius: 2,
                            elevation: 1,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                        },
                        animatedIndicatorStyle,
                    ]}
                />
                {(['name', 'count', 'recent'] as const).map((sort) => (
                    <TouchableOpacity
                        key={sort}
                        style={styles.sortButton}
                        onPress={() => handleSortChange(sort)}
                        activeOpacity={0.7}
                        onLayout={(event) => {
                            const { x, width } = event.nativeEvent.layout;
                            buttonLayouts.current[sort] = { x, width };
                            if (sortBy === sort && indicatorWidth.value === 0) {
                                indicatorLeft.value = x;
                                indicatorWidth.value = width;
                            }
                        }}
                    >
                        <Feather
                            name={sort === 'name' ? 'file-text' : sort === 'count' ? 'bar-chart-2' : 'clock'}
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
                            {sort === 'name' ? 'Name' : sort === 'count' ? 'Videos' : 'Recent'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    ), [sortBy, theme.colors, handleSortChange, animatedIndicatorStyle, indicatorLeft, indicatorWidth]);

    if (loading && albums.length === 0) {
        return <Loader />;
    }

    return (
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
            <View style={[styles.container, { paddingTop: insets.top }]}>
                {renderHeaderMain()}
                {renderSortBar()}

                <View style={{ flex: 1 }}>
                    <FlashList
                        ref={flashListRef}
                        data={sortedAlbums}
                        renderItem={renderAlbum}
                        keyExtractor={(item: AlbumWithCount) => item.title}
                        estimatedItemSize={viewMode === 'grid' ? GRID_ITEM_HEIGHT : LIST_ITEM_HEIGHT}
                        numColumns={viewMode === 'grid' ? 2 : 1}
                        key={viewMode}
                        contentContainerStyle={
                            sortedAlbums.length === 0
                                ? styles.emptyListContainer
                                : [styles.listContent, viewMode === 'grid' && styles.gridListContent]
                        }
                        refreshControl={
                            <RefreshControl
                                refreshing={loading}
                                onRefresh={refetch}
                                tintColor={theme.colors.primary}
                                colors={[theme.colors.primary]}
                            />
                        }
                        extraData={viewMode}
                        showsVerticalScrollIndicator={false}
                        itemLayoutAnimation={LinearTransition.springify().damping(15).stiffness(300)}
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
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 30,
        paddingTop: 26,
        paddingBottom: 26,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 14,
        marginTop: 2,
        fontWeight: '500',
    },
    headerActions: {
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
    listContent: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 100,
    },
    gridListContent: {
        paddingHorizontal: GRID_SPACING,
    },
    emptyListContainer: {
        flexGrow: 1,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
        marginTop: 40,
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
        opacity: 0.7,
    },
    // Grid Styles
    gridItemContainer: {
        flex: 1,
        margin: GRID_SPACING / 2,
        maxWidth: GRID_ITEM_WIDTH,
    },
    folderGridCard: {
        borderRadius: 16,
        overflow: 'hidden',
        height: GRID_ITEM_HEIGHT,
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
    },
    thumbnail: {
        flex: 1,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    thumbnailImage: {
        width: '100%',
        height: '100%',
    },
    gridCountBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: 'rgba(0,0,0,0.6)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    gridCountText: {
        color: '#FFF',
        fontSize: 10,
        fontWeight: 'bold',
    },
    folderInfo: {
        padding: 12,
        height: 48, // Fixed height for info area
        justifyContent: 'center',
    },
    folderName: {
        fontSize: 14,
        fontWeight: '600',
    },
    // List Styles
    folderListItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        marginBottom: 12,
        borderRadius: 16,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    listThumbnail: {
        width: 64,
        height: 64,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
        overflow: 'hidden',
    },
    listInfo: {
        flex: 1,
        gap: 4,
    },
    folderListName: {
        fontSize: 16,
        fontWeight: '600',
    },
    listCount: {
        fontSize: 13,
    },
});