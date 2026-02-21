import { useState, useEffect, useCallback } from 'react';
import { MediaService } from '@/services/MediaService';
import { VideoFile } from '@/types';

const albumVideosCache = new Map<string, {
    videos: VideoFile[];
    pageInfo: { has_next_page: boolean; end_cursor?: string | null };
}>();
const dirtyAlbumCovers = new Set<string>();

export function markAlbumCoverDirty(albumTitle: string | null | undefined) {
    if (!albumTitle) return;
    dirtyAlbumCovers.add(albumTitle);
}

export function consumeDirtyAlbumCovers(): string[] {
    const albums = Array.from(dirtyAlbumCovers);
    dirtyAlbumCovers.clear();
    return albums;
}

export function useAlbums() {
    const [albums, setAlbums] = useState<Array<{ title: string; count: number }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchAlbums = useCallback(async () => {
        setLoading(true);
        try {
            const data = await MediaService.getAlbums();
            setAlbums(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to fetch albums'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAlbums();
    }, [fetchAlbums]);

    return { albums, loading, error, refetch: fetchAlbums };
}

export function useAlbumVideos(albumTitle: string | null) {
    const [videos, setVideos] = useState<VideoFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [pageInfo, setPageInfo] = useState<{ has_next_page: boolean; end_cursor?: string | null }>({
        has_next_page: true,
        end_cursor: null,
    });

    const fetchVideos = useCallback(async (refresh = false) => {
        if (!albumTitle) return;
        if (!refresh && !pageInfo.has_next_page) return;
        if (loading || loadingMore) return; // Prevent duplicate fetches

        if (refresh) {
            setLoading(true);
        } else {
            setLoadingMore(true);
        }

        try {
            // Use current cursor if loading more, otherwise undefined for refresh/first load
            const afterCursor = refresh ? undefined : (pageInfo.end_cursor || undefined);
            const result = await MediaService.getVideos(albumTitle, 50, afterCursor, refresh);

            // Map to VideoFile type
            const mappedVideos: VideoFile[] = result.edges.map(edge => ({
                name: edge.name,
                path: edge.path,
                uri: edge.uri, // Original content:// URI for CameraRoll.deletePhotos
                size: edge.size, // Size in bytes
                modifiedDate: edge.timestamp * 1000, // Convert to milliseconds
                duration: edge.duration, // Already in seconds from MediaService
                width: edge.width,
                height: edge.height,
                album: albumTitle,
                isDirectory: false,
            }));

            if (refresh) {
                setVideos(mappedVideos);
                albumVideosCache.set(albumTitle, { videos: mappedVideos, pageInfo: result.page_info });
            } else {
                setVideos(prev => {
                    const merged = [...prev, ...mappedVideos];
                    albumVideosCache.set(albumTitle, { videos: merged, pageInfo: result.page_info });
                    return merged;
                });
            }

            setPageInfo(result.page_info);
        } catch (error) {
            console.error('Failed to fetch album videos:', error);
        } finally {
            if (refresh) {
                setLoading(false);
            } else {
                setLoadingMore(false);
            }
        }
    }, [albumTitle, pageInfo.end_cursor, pageInfo.has_next_page, loading, loadingMore]);

    useEffect(() => {
        if (!albumTitle) return;
        const cached = albumVideosCache.get(albumTitle);
        if (cached) {
            setVideos(cached.videos);
            setPageInfo(cached.pageInfo);
            // Background refresh to keep cache fresh without blocking initial paint.
            fetchVideos(true);
            return;
        }

        setVideos([]);
        setPageInfo({ has_next_page: true, end_cursor: null });
        fetchVideos(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [albumTitle]);

    return {
        videos,
        loading,
        loadingMore,
        hasMore: pageInfo.has_next_page,
        loadMore: () => fetchVideos(false),
        refetch: () => {
            if (albumTitle) {
                albumVideosCache.delete(albumTitle);
                MediaService.invalidateVideosCache(albumTitle);
            }
            return fetchVideos(true);
        }
    };
}
// ... existing code

export function useAlbumCover(albumTitle: string, refreshKey: number = 0) {
    const [coverVideo, setCoverVideo] = useState<VideoFile | null>(null);

    useEffect(() => {
        let isMounted = true;

        const fetchCover = async () => {
            try {
                // Only fetch 1 video for the cover
                const result = await MediaService.getVideos(albumTitle, 1);
                if (isMounted && result.edges.length > 0) {
                    const edge = result.edges[0];
                    setCoverVideo({
                        name: edge.name,
                        path: edge.path,
                        size: edge.size,
                        modifiedDate: edge.timestamp,
                        duration: edge.duration * 1000,
                        album: albumTitle,
                        isDirectory: false
                    });
                } else if (isMounted) {
                    // Album may be empty after deletes; clear stale cover.
                    setCoverVideo(null);
                }
            } catch (error) {
                // ignore
            }
        };

        fetchCover();

        return () => { isMounted = false; };
    }, [albumTitle, refreshKey]);

    return coverVideo;
}
