import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { PermissionService } from './PermissionService';
import { FileService } from './FileService';

class MediaServiceClass {
    private videoPageCache = new Map<string, {
        data: {
            edges: Array<{
                name: string;
                path: string;
                uri: string;
                duration: number;
                size: number;
                width?: number;
                height?: number;
                timestamp: number;
            }>;
            page_info: {
                has_next_page: boolean;
                end_cursor?: string | null;
            };
        };
        ts: number;
    }>();
    private resolvedPathCache = new Map<string, { path: string; ts: number }>();
    private static readonly PAGE_CACHE_TTL_MS = 5 * 60 * 1000;
    private static readonly PAGE_CACHE_MAX_ENTRIES = 200;
    private static readonly PATH_CACHE_TTL_MS = 30 * 60 * 1000;
    private static readonly PATH_CACHE_MAX_ENTRIES = 2000;

    private getVideosCacheKey(albumName: string | null, limit: number, after?: string): string {
        return `${albumName ?? '__all__'}|${limit}|${after ?? ''}`;
    }

    getCachedVideosPage(albumName: string | null, limit = 50, after?: string) {
        const key = this.getVideosCacheKey(albumName, limit, after);
        const entry = this.videoPageCache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.ts > MediaServiceClass.PAGE_CACHE_TTL_MS) {
            this.videoPageCache.delete(key);
            return null;
        }
        return entry.data;
    }

    invalidateVideosCache(albumName?: string | null) {
        if (!albumName) {
            this.videoPageCache.clear();
            return;
        }
        const prefix = `${albumName}|`;
        for (const key of this.videoPageCache.keys()) {
            if (key.startsWith(prefix)) {
                this.videoPageCache.delete(key);
            }
        }
    }
    /**
     * Get all albums that contain videos
     */
    async getAlbums(): Promise<Array<{ title: string; count: number }>> {
        const hasPermission = await PermissionService.hasAndroidPermission();
        if (!hasPermission) {
            console.warn('[MediaService] No permission to access media');
            return [];
        }

        try {
            const albums = await CameraRoll.getAlbums({ assetType: 'Videos' });
            return albums.map(a => ({ title: a.title, count: a.count }));
        } catch (error) {
            console.error('[MediaService] Failed to get albums:', error);
            return [];
        }
    }

    /**
     * Get videos from a specific album (or all videos if albumName is null)
     */
    async getVideos(albumName: string | null, limit = 50, after?: string, forceRefresh = false): Promise<{
        edges: Array<{
            name: string;
            path: string;
            uri: string; // Original content:// URI for CameraRoll.deletePhotos
            duration: number;
            size: number;
            width?: number;
            height?: number;
            timestamp: number;
        }>;
        page_info: {
            has_next_page: boolean;
            end_cursor?: string | null;
        };
    }> {
        const cacheKey = this.getVideosCacheKey(albumName, limit, after);
        if (!forceRefresh) {
            const cached = this.getCachedVideosPage(albumName, limit, after);
            if (cached) {
                return cached;
            }
        }

        const hasPermission = await PermissionService.hasAndroidPermission();
        if (!hasPermission) {
            return { edges: [], page_info: { has_next_page: false } };
        }

        try {
            const fetchParams: any = {
                first: limit,
                assetType: 'Videos',
                include: ['filename', 'fileSize', 'playableDuration'],
            };

            if (albumName) {
                fetchParams.groupName = albumName;
            }

            if (after) {
                fetchParams.after = after;
            }

            const photos = await CameraRoll.getPhotos(fetchParams);

            // Map and resolve content:// URIs to real file paths
            const edges = await Promise.all(photos.edges.map(async (e) => {
                const node = e.node;
                const originalUri = node.image.uri; // Keep original URI for CameraRoll.deletePhotos
                let videoPath = originalUri;

                // Resolve content:// URIs to real file paths
                if (videoPath.startsWith('content://')) {
                    const cachedPath = this.resolvedPathCache.get(videoPath);
                    if (cachedPath) {
                        if (Date.now() - cachedPath.ts <= MediaServiceClass.PATH_CACHE_TTL_MS) {
                            videoPath = cachedPath.path;
                        } else {
                            this.resolvedPathCache.delete(videoPath);
                        }
                    } else {
                        try {
                            videoPath = await FileService.resolveToRealPath(videoPath);
                            this.resolvedPathCache.set(originalUri, { path: videoPath, ts: Date.now() });
                            this.enforcePathCacheLimits();
                        } catch (error) {
                            console.error('[MediaService] Failed to resolve path:', videoPath, error);
                            // Keep original path if resolution fails
                        }
                    }
                }

                return {
                    name: node.image.filename || 'Unknown Video',
                    path: videoPath,
                    uri: originalUri, // Original content:// URI for deletion
                    duration: node.image.playableDuration || 0,
                    size: node.image.fileSize || 0,
                    width: node.image.width,
                    height: node.image.height,
                    timestamp: node.timestamp,
                };
            }));

            const result = {
                edges,
                page_info: photos.page_info,
            };
            this.videoPageCache.set(cacheKey, { data: result, ts: Date.now() });
            this.enforcePageCacheLimits();
            return result;

        } catch (error) {
            console.error('[MediaService] Failed to get videos:', error);
            return { edges: [], page_info: { has_next_page: false } };
        }
    }

    private enforcePageCacheLimits() {
        const now = Date.now();
        for (const [key, value] of this.videoPageCache.entries()) {
            if (now - value.ts > MediaServiceClass.PAGE_CACHE_TTL_MS) {
                this.videoPageCache.delete(key);
            }
        }
        while (this.videoPageCache.size > MediaServiceClass.PAGE_CACHE_MAX_ENTRIES) {
            const oldestKey = this.videoPageCache.keys().next().value;
            if (!oldestKey) break;
            this.videoPageCache.delete(oldestKey);
        }
    }

    private enforcePathCacheLimits() {
        const now = Date.now();
        for (const [key, value] of this.resolvedPathCache.entries()) {
            if (now - value.ts > MediaServiceClass.PATH_CACHE_TTL_MS) {
                this.resolvedPathCache.delete(key);
            }
        }
        while (this.resolvedPathCache.size > MediaServiceClass.PATH_CACHE_MAX_ENTRIES) {
            const oldestKey = this.resolvedPathCache.keys().next().value;
            if (!oldestKey) break;
            this.resolvedPathCache.delete(oldestKey);
        }
    }
}

export const MediaService = new MediaServiceClass();
