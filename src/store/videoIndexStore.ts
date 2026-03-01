import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import { VideoFile } from '../types';
import { MediaService } from '../services/MediaService';

const mmkv = createMMKV({ id: 'video_index_v1' });
const INDEX_KEY = '@video_index_v1';

// ============= TYPES =============

interface PersistedAlbum {
    title: string;
    count: number;
    latestTimestamp: number;
    videos: VideoFile[];
}

interface PersistedVideoIndex {
    version: number;
    lastFullSyncAt: number;
    albums: PersistedAlbum[];
}

interface VideoIndexState {
    // State
    albums: Map<string, PersistedAlbum>;
    isIndexing: boolean;
    isIndexReady: boolean;
    indexProgress: { scanned: number; total: number } | null;
    lastFullSyncAt: number | null;

    // Actions
    initialize: () => Promise<void>;
    forceFullSync: () => Promise<void>;
    searchVideos: (query: string) => VideoFile[];

    // Internal
    _syncAlbum: (albumTitle: string) => Promise<PersistedAlbum | null>;
    _persistToStorage: () => void;
}

// ============= HELPERS =============

function loadFromStorage(): PersistedVideoIndex | null {
    try {
        const cached = mmkv.getString(INDEX_KEY);
        if (cached) {
            return JSON.parse(cached) as PersistedVideoIndex;
        }
    } catch (error) {
        console.error('[VideoIndexStore] Load error:', error);
    }
    return null;
}

// ============= STORE =============

export const useVideoIndexStore = create<VideoIndexState>((set, get) => ({
    albums: new Map(),
    isIndexing: false,
    isIndexReady: false,
    indexProgress: null,
    lastFullSyncAt: null,

    initialize: async () => {
        const state = get();
        if (state.isIndexing) {
            if (__DEV__) {console.log('[VideoIndexStore] Already indexing, skipping');}
            return;
        }

        if (__DEV__) {console.log('[VideoIndexStore] Initializing...');}
        set({ isIndexing: true, indexProgress: { scanned: 0, total: 0 } });

        try {
            // 1. Load cached data from MMKV
            const cached = loadFromStorage();

            if (!cached || cached.albums.length === 0) {
                // First launch - full index
                if (__DEV__) {console.log('[VideoIndexStore] No cached data, performing full index');}
                await get().forceFullSync();
                return;
            }

            // 2. Load cached albums into state
            const cachedAlbumsMap = new Map<string, PersistedAlbum>();
            for (const album of cached.albums) {
                cachedAlbumsMap.set(album.title, album);
            }
            set({ albums: cachedAlbumsMap, lastFullSyncAt: cached.lastFullSyncAt });

            // 3. Get current album counts from CameraRoll
            const currentAlbums = await MediaService.getAlbums();
            if (__DEV__) {console.log('[VideoIndexStore] Current albums:', currentAlbums.length);}

            // 4. Diff and sync only changed albums
            const albumsToSync: string[] = [];
            const currentAlbumTitles = new Set(currentAlbums.map(a => a.title));

            for (const current of currentAlbums) {
                const cachedAlbum = cachedAlbumsMap.get(current.title);

                if (!cachedAlbum) {
                    // New album
                    if (__DEV__) {console.log(`[VideoIndexStore] New album: ${current.title}`);}
                    albumsToSync.push(current.title);
                } else if (cachedAlbum.count !== current.count) {
                    // Count changed
                    if (__DEV__) {console.log(`[VideoIndexStore] Count changed for ${current.title}: ${cachedAlbum.count} -> ${current.count}`);}
                    albumsToSync.push(current.title);
                }
                // Note: We can't easily get latestTimestamp from getAlbums without fetching videos
                // So count-based diff is the primary mechanism for incremental sync
            }

            // 5. Remove deleted albums from cache
            for (const cachedTitle of cachedAlbumsMap.keys()) {
                if (!currentAlbumTitles.has(cachedTitle)) {
                    if (__DEV__) {console.log(`[VideoIndexStore] Removing deleted album: ${cachedTitle}`);}
                    cachedAlbumsMap.delete(cachedTitle);
                }
            }

            // 6. Sync changed albums
            if (albumsToSync.length > 0) {
                if (__DEV__) {console.log(`[VideoIndexStore] Syncing ${albumsToSync.length} albums...`);}
                set({ indexProgress: { scanned: 0, total: albumsToSync.length } });

                for (let i = 0; i < albumsToSync.length; i++) {
                    const albumTitle = albumsToSync[i];
                    const syncedAlbum = await get()._syncAlbum(albumTitle);
                    if (syncedAlbum) {
                        const updatedAlbums = new Map(get().albums);
                        updatedAlbums.set(albumTitle, syncedAlbum);
                        set({
                            albums: updatedAlbums,
                            indexProgress: { scanned: i + 1, total: albumsToSync.length },
                        });
                    }
                }

                // Persist updated index
                get()._persistToStorage();
            }

            if (__DEV__) {console.log('[VideoIndexStore] Initialization complete');}
            set({ isIndexing: false, isIndexReady: true, indexProgress: null });

        } catch (error) {
            console.error('[VideoIndexStore] Initialization error:', error);
            set({ isIndexing: false, indexProgress: null });
        }
    },

    forceFullSync: async () => {
        if (__DEV__) {console.log('[VideoIndexStore] Starting full sync...');}
        set({
            isIndexing: true,
            isIndexReady: false,
            indexProgress: { scanned: 0, total: 0 },
        });

        try {
            // Get all albums
            const albums = await MediaService.getAlbums();
            if (__DEV__) {console.log(`[VideoIndexStore] Found ${albums.length} albums`);}

            // Calculate total videos for progress
            const totalVideos = albums.reduce((sum, a) => sum + a.count, 0);
            set({ indexProgress: { scanned: 0, total: totalVideos } });

            const newAlbumsMap = new Map<string, PersistedAlbum>();
            let scannedCount = 0;

            // Fetch videos for each album
            for (const album of albums) {
                if (__DEV__) {console.log(`[VideoIndexStore] Fetching ${album.title} (${album.count} videos)...`);}

                const allVideos: VideoFile[] = [];
                let cursor: string | undefined;
                let hasMore = true;
                let latestTimestamp = 0;

                while (hasMore) {
                    const result = await MediaService.getVideos(album.title, 100, cursor);

                    const mappedVideos: VideoFile[] = result.edges.map(edge => {
                        if (edge.timestamp > latestTimestamp) {
                            latestTimestamp = edge.timestamp;
                        }
                        return {
                            name: edge.name,
                            path: edge.path,
                            uri: edge.uri,
                            size: edge.size,
                            modifiedDate: edge.timestamp * 1000,
                            duration: edge.duration,
                            width: edge.width,
                            height: edge.height,
                            album: album.title,
                            isDirectory: false,
                        };
                    });

                    allVideos.push(...mappedVideos);
                    scannedCount += mappedVideos.length;
                    set({ indexProgress: { scanned: scannedCount, total: totalVideos } });

                    hasMore = result.page_info.has_next_page;
                    cursor = result.page_info.end_cursor || undefined;
                }

                newAlbumsMap.set(album.title, {
                    title: album.title,
                    count: allVideos.length,
                    latestTimestamp,
                    videos: allVideos,
                });
            }

            set({
                albums: newAlbumsMap,
                lastFullSyncAt: Date.now(),
                isIndexing: false,
                isIndexReady: true,
                indexProgress: null,
            });

            // Persist to storage
            get()._persistToStorage();

            if (__DEV__) {console.log(`[VideoIndexStore] Full sync complete. Indexed ${scannedCount} videos.`);}

        } catch (error) {
            console.error('[VideoIndexStore] Full sync error:', error);
            set({ isIndexing: false, indexProgress: null });
        }
    },

    searchVideos: (query: string): VideoFile[] => {
        const q = query.toLowerCase().trim();
        if (!q) {return [];}

        const { albums, isIndexReady } = get();
        if (!isIndexReady) {return [];}

        const allVideos: VideoFile[] = [];
        for (const album of albums.values()) {
            allVideos.push(...album.videos);
        }

        return allVideos.filter(v => v.name.toLowerCase().includes(q));
    },

    _syncAlbum: async (albumTitle: string): Promise<PersistedAlbum | null> => {
        try {
            const allVideos: VideoFile[] = [];
            let cursor: string | undefined;
            let hasMore = true;
            let latestTimestamp = 0;

            while (hasMore) {
                const result = await MediaService.getVideos(albumTitle, 100, cursor);

                const mappedVideos: VideoFile[] = result.edges.map(edge => {
                    if (edge.timestamp > latestTimestamp) {
                        latestTimestamp = edge.timestamp;
                    }
                    return {
                        name: edge.name,
                        path: edge.path,
                        uri: edge.uri,
                        size: edge.size,
                        modifiedDate: edge.timestamp * 1000,
                        duration: edge.duration,
                        width: edge.width,
                        height: edge.height,
                        album: albumTitle,
                        isDirectory: false,
                    };
                });

                allVideos.push(...mappedVideos);

                hasMore = result.page_info.has_next_page;
                cursor = result.page_info.end_cursor || undefined;
            }

            return {
                title: albumTitle,
                count: allVideos.length,
                latestTimestamp,
                videos: allVideos,
            };
        } catch (error) {
            console.error(`[VideoIndexStore] Failed to sync album ${albumTitle}:`, error);
            return null;
        }
    },

    _persistToStorage: () => {
        try {
            const { albums, lastFullSyncAt } = get();
            const data: PersistedVideoIndex = {
                version: 1,
                lastFullSyncAt: lastFullSyncAt || Date.now(),
                albums: Array.from(albums.values()),
            };
            mmkv.set(INDEX_KEY, JSON.stringify(data));
            if (__DEV__) {console.log('[VideoIndexStore] Persisted to storage');}
        } catch (error) {
            console.error('[VideoIndexStore] Persist error:', error);
        }
    },
}));


