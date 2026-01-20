import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { PermissionService } from './PermissionService';
import { FileService } from './FileService';

class MediaServiceClass {
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
    async getVideos(albumName: string | null, limit = 50, after?: string): Promise<{
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
                    try {
                        videoPath = await FileService.resolveToRealPath(videoPath);
                    } catch (error) {
                        console.error('[MediaService] Failed to resolve path:', videoPath, error);
                        // Keep original path if resolution fails
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

            return {
                edges,
                page_info: photos.page_info,
            };

        } catch (error) {
            console.error('[MediaService] Failed to get videos:', error);
            return { edges: [], page_info: { has_next_page: false } };
        }
    }
}

export const MediaService = new MediaServiceClass();
