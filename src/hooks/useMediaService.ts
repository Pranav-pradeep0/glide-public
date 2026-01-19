import { useState, useEffect, useCallback } from 'react';
import { MediaService } from '@/services/MediaService';
import { VideoFile } from '@/types';

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
            const result = await MediaService.getVideos(albumTitle, 50, afterCursor);

            // Map to VideoFile type
            const mappedVideos: VideoFile[] = result.edges.map(edge => ({
                name: edge.name,
                path: edge.path,
                uri: edge.uri, // Original content:// URI for CameraRoll.deletePhotos
                size: edge.size, // Size in bytes
                modifiedDate: edge.timestamp,
                duration: edge.duration * 1000,
                album: albumTitle,
                isDirectory: false,
            }));

            if (refresh) {
                setVideos(mappedVideos);
            } else {
                setVideos(prev => [...prev, ...mappedVideos]);
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
        refetch: () => fetchVideos(true)
    };
}
// ... existing code

export function useAlbumCover(albumTitle: string) {
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
                }
            } catch (error) {
                // ignore
            }
        };

        fetchCover();

        return () => { isMounted = false; };
    }, [albumTitle]);

    return coverVideo;
}
