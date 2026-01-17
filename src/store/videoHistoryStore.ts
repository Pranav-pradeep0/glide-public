import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import { VideoHistoryEntry, VideoBookmark } from '../types';

const mmkv = createMMKV({ id: 'video_history_v1' });
const HISTORY_KEY = '@video_history_v1';

interface VideoHistoryState {
    history: Map<string, VideoHistoryEntry>;
    isHydrated: boolean;

    // Actions
    getVideoHistory: (videoPath: string) => VideoHistoryEntry | null;
    getAllHistory: () => VideoHistoryEntry[];
    updateVideoHistory: (entry: Partial<VideoHistoryEntry> & { videoPath: string; videoName: string }) => void;
    incrementViewCount: (videoPath: string, videoName: string) => void;
    updatePlaybackPosition: (videoPath: string, videoName: string, position: number, duration: number, audioTrackId?: number, subtitleTrackIndex?: number, audioDelay?: number, subtitleDelay?: number, brightness?: number) => void;
    addBookmark: (videoPath: string, videoName: string, timestamp: number, label?: string) => void;
    removeBookmark: (videoPath: string, bookmarkId: string) => void;
    updateBookmarkLabel: (videoPath: string, bookmarkId: string, label: string) => void;
    clearVideoHistory: (videoPath: string) => void;
    clearAllHistory: () => void;

    // Persistence
    hydrateFromStorage: () => Promise<void>;
    persistToStorage: () => void;
    persistNow: () => void;
}

// Batch persistence to reduce writes
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistRaf: number | null = null;

function debouncedPersist() {
    if (persistTimer) clearTimeout(persistTimer);
    if (persistRaf) cancelAnimationFrame(persistRaf);

    // Use RAF for immediate feedback, timeout for actual write
    persistRaf = requestAnimationFrame(() => {
        persistRaf = null;
    });

    persistTimer = setTimeout(() => {
        useVideoHistoryStore.getState().persistToStorage();
        persistTimer = null;
    }, 500);
}

// Synchronous Initialization
// Load history immediately when the file is imported (App start)
// effectively eliminating the "loading" state
let initialHistory = new Map<string, VideoHistoryEntry>();
try {
    const cached = mmkv.getString(HISTORY_KEY);
    if (cached) {
        const data = JSON.parse(cached) as VideoHistoryEntry[];
        initialHistory = new Map(data.map((entry) => [entry.videoPath, entry]));
    }
} catch (error) {
    console.error('[VideoHistoryStore] Sync init error:', error);
}

export const useVideoHistoryStore = create<VideoHistoryState>((set, get) => ({
    history: initialHistory,
    isHydrated: true, // Always hydrated now

    getVideoHistory: (videoPath: string) => {
        return get().history.get(videoPath) || null;
    },

    getAllHistory: () => {
        const historyMap = get().history;
        return Array.from(historyMap.values()).sort(
            (a, b) => b.lastWatchedTime - a.lastWatchedTime
        );
    },

    updateVideoHistory: (entry) => {
        const { videoPath, videoName, ...updates } = entry;
        set((state) => {
            const newHistory = new Map(state.history);
            const existing = newHistory.get(videoPath);

            if (existing) {
                newHistory.set(videoPath, {
                    ...existing,
                    ...updates,
                    videoPath,
                    videoName,
                    lastWatchedTime: Date.now(),
                });
            } else {
                newHistory.set(videoPath, {
                    videoPath,
                    videoName,
                    lastWatchedTime: Date.now(),
                    lastPausedPosition: 0,
                    duration: 0,
                    viewCount: 0,
                    bookmarks: [],
                    ...updates,
                });
            }

            return { history: newHistory };
        });
        debouncedPersist();
    },

    incrementViewCount: (videoPath: string, videoName: string) => {
        // Skip content:// and http/https URIs - they can't be replayed after permission expires
        if (videoPath.startsWith('content://') || (videoPath.startsWith('http://') ||
            videoPath.startsWith('https://'))) {
            return;
        }

        set((state) => {
            const newHistory = new Map(state.history);
            const existing = newHistory.get(videoPath);

            if (existing) {
                newHistory.set(videoPath, {
                    ...existing,
                    viewCount: existing.viewCount + 1,
                    lastWatchedTime: Date.now(),
                });
            } else {
                newHistory.set(videoPath, {
                    videoPath,
                    videoName,
                    lastWatchedTime: Date.now(),
                    lastPausedPosition: 0,
                    duration: 0,
                    viewCount: 1,
                    bookmarks: [],
                });
            }

            return { history: newHistory };
        });
        debouncedPersist();
    },

    updatePlaybackPosition: (videoPath, videoName, position, duration, audioTrackId, subtitleTrackIndex, audioDelay, subtitleDelay, brightness) => {
        // Skip content:// URIs - they can't be replayed after permission expires
        if (videoPath.startsWith('content://')) {
            return;
        }

        set((state) => {
            const newHistory = new Map(state.history);
            const existing = newHistory.get(videoPath);

            if (existing) {
                newHistory.set(videoPath, {
                    ...existing,
                    lastPausedPosition: position,
                    duration: duration,
                    lastWatchedTime: Date.now(),
                    selectedAudioTrackId: audioTrackId,
                    selectedSubtitleTrackId: subtitleTrackIndex,
                    audioDelay: audioDelay,
                    audioDelay: audioDelay,
                    subtitleDelay: subtitleDelay,
                    brightness: brightness,
                });
            } else {
                newHistory.set(videoPath, {
                    videoPath,
                    videoName,
                    lastWatchedTime: Date.now(),
                    lastPausedPosition: position,
                    duration: duration,
                    viewCount: 0,
                    bookmarks: [],
                    selectedAudioTrackId: audioTrackId,
                    selectedSubtitleTrackId: subtitleTrackIndex,
                    audioDelay: audioDelay,
                    audioDelay: audioDelay,
                    subtitleDelay: subtitleDelay,
                    brightness: brightness,
                });
            }

            return { history: newHistory };
        });
        debouncedPersist();
    },

    addBookmark: (videoPath: string, videoName: string, timestamp: number, label?: string) => {
        set((state) => {
            const newHistory = new Map(state.history);
            const existing = newHistory.get(videoPath);

            const newBookmark: VideoBookmark = {
                id: `${videoPath}-${timestamp}-${Date.now()}`,
                timestamp,
                createdAt: Date.now(),
                label,
            };

            if (existing) {
                // Check for duplicate bookmark (within 2 seconds)
                const isDuplicate = existing.bookmarks.some(
                    b => Math.abs(b.timestamp - timestamp) < 2
                );

                if (isDuplicate) {
                    console.warn('[VideoHistoryStore] Duplicate bookmark detected, skipping');
                    return state;
                }

                newHistory.set(videoPath, {
                    ...existing,
                    bookmarks: [...existing.bookmarks, newBookmark].sort((a, b) => a.timestamp - b.timestamp),
                });
            } else {
                newHistory.set(videoPath, {
                    videoPath,
                    videoName,
                    lastWatchedTime: Date.now(),
                    lastPausedPosition: 0,
                    duration: 0,
                    viewCount: 0,
                    bookmarks: [newBookmark],
                });
            }

            return { history: newHistory };
        });

        // Immediate persist for bookmarks
        get().persistNow();
    },

    removeBookmark: (videoPath: string, bookmarkId: string) => {
        set((state) => {
            const newHistory = new Map(state.history);
            const existing = newHistory.get(videoPath);

            if (existing) {
                newHistory.set(videoPath, {
                    ...existing,
                    bookmarks: existing.bookmarks.filter((b) => b.id !== bookmarkId),
                });
            }

            return { history: newHistory };
        });

        // Immediate persist for bookmark deletion
        get().persistNow();
    },

    updateBookmarkLabel: (videoPath: string, bookmarkId: string, label: string) => {
        set((state) => {
            const newHistory = new Map(state.history);
            const existing = newHistory.get(videoPath);

            if (existing) {
                newHistory.set(videoPath, {
                    ...existing,
                    bookmarks: existing.bookmarks.map((b) =>
                        b.id === bookmarkId ? { ...b, label } : b
                    ),
                });
            }

            return { history: newHistory };
        });
        debouncedPersist();
    },

    clearVideoHistory: (videoPath: string) => {
        set((state) => {
            const newHistory = new Map(state.history);
            newHistory.delete(videoPath);
            return { history: newHistory };
        });
        debouncedPersist();
    },

    clearAllHistory: () => {
        set({ history: new Map() });
        mmkv.remove(HISTORY_KEY);
    },

    // Deprecated: No longer needed with sync initialization
    hydrateFromStorage: async () => { },

    persistToStorage: () => {
        try {
            const state = get();
            const dataToSave = Array.from(state.history.values());
            mmkv.set(HISTORY_KEY, JSON.stringify(dataToSave));
        } catch (error) {
            console.error('[VideoHistoryStore] Persist error:', error);
        }
    },

    persistNow: () => {
        // Clear pending debounce timers
        if (persistTimer) clearTimeout(persistTimer);
        if (persistRaf) cancelAnimationFrame(persistRaf);
        persistTimer = null;
        persistRaf = null;

        // Force synchronous save
        get().persistToStorage();
    },
}));