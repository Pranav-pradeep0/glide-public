import { create } from 'zustand';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { AudioRepeatMode, AudioTrack } from '@/types';
import { AudioMediaService } from '@/services/AudioMediaService';
import { EQUALIZER_PRESETS } from '@/config/equalizerPresets';
import { useMusicHistoryStore } from '@/store/musicHistoryStore';

const getAudioModule = () => NativeModules.GlideAudioPlayerModule;
const mmkv = createMMKV({ id: 'glide_audio_store_v1' });

const QUEUE_KEY = '@glide_audio_queue';
const PLAYBACK_KEY = '@glide_audio_playback_state';

interface StoredPlaybackState {
    currentIndex: number;
    position: number;
    duration: number;
    shuffle: boolean;
    repeatMode: AudioRepeatMode;
    equalizerPreset: string;
    queueSource?: string;
}

let initialQueue: AudioTrack[] = [];
let initialPlayback: StoredPlaybackState = {
    currentIndex: 0,
    position: 0,
    duration: 0,
    shuffle: false,
    repeatMode: 'off',
    equalizerPreset: 'flat',
    queueSource: 'Library',
};

try {
    const rawQueue = mmkv.getString(QUEUE_KEY);
    if (rawQueue) {
        initialQueue = JSON.parse(rawQueue);
    }
    const rawPlayback = mmkv.getString(PLAYBACK_KEY);
    if (rawPlayback) {
        initialPlayback = { ...initialPlayback, ...JSON.parse(rawPlayback) };
    }
} catch {
    // ignore
}

const safeInitialIndex = initialQueue.length > 0 ? Math.max(0, Math.min(initialPlayback.currentIndex, initialQueue.length - 1)) : 0;
const initialTrack = initialQueue.length > 0 ? initialQueue[safeInitialIndex] : null;

function persistQueue(queue: AudioTrack[]) {
    try {
        mmkv.set(QUEUE_KEY, JSON.stringify(queue));
    } catch {
        // ignore
    }
}

let playbackPersistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersistPlayback(state: StoredPlaybackState) {
    if (playbackPersistTimer) clearTimeout(playbackPersistTimer);
    playbackPersistTimer = setTimeout(() => {
        try {
            mmkv.set(PLAYBACK_KEY, JSON.stringify(state));
        } catch {
            // ignore
        }
    }, 500);
    playbackPersistTimer?.unref?.();
}

function getPresetBands(presetId: string): number[] | null {
    const preset = EQUALIZER_PRESETS.find((p) => p.id === presetId);
    return preset?.values ?? null;
}

let sleepTimerInterval: any = null;
function clearSleepTimerInterval() {
    if (sleepTimerInterval) {
        clearInterval(sleepTimerInterval);
        sleepTimerInterval = null;
    }
}

export interface AudioStoreState {
    currentTrack: AudioTrack | null;
    queue: AudioTrack[];
    currentIndex: number;
    isPlaying: boolean;
    isBuffering: boolean;
    position: number;
    duration: number;
    shuffle: boolean;
    repeatMode: AudioRepeatMode;
    equalizerPreset: string;
    shuffledIndices: number[];
    queueSource?: string;
    sleepTimerMode: 'off' | 'time' | 'end_of_track';
    sleepTimerRemaining: number;

    // Actions
    playTrack: (track: AudioTrack, newQueue?: AudioTrack[], queueSource?: string) => Promise<void>;
    playQueue: (queue: AudioTrack[], startIndex?: number, queueSource?: string) => Promise<void>;
    playNext: (track: AudioTrack) => Promise<void>;
    addToQueue: (track: AudioTrack) => Promise<void>;
    removeFromQueue: (index: number) => Promise<void>;
    moveQueueItem: (fromIndex: number, toIndex: number) => Promise<void>;
    setSleepTimer: (option: number | 'end_of_track' | 'off') => void;
    togglePlayPause: () => Promise<void>;
    play: () => Promise<void>;
    pause: () => Promise<void>;
    seekTo: (seconds: number) => Promise<void>;
    skipNext: () => Promise<void>;
    skipPrevious: () => Promise<void>;
    skipToIndex: (index: number) => Promise<void>;
    toggleShuffle: () => Promise<void>;
    toggleRepeatMode: () => Promise<void>;
    setAudioEqualizer: (bands: number[]) => Promise<void>;
    setEqualizerPreset: (presetId: string) => Promise<void>;
    clearQueue: () => Promise<void>;

    // Internal updates from native events
    _setPlaybackState: (state: { isPlaying: boolean; isBuffering: boolean; position?: number; duration?: number }) => void;
    _setTrackChanged: (data: { currentIndex: number; trackId?: string; duration?: number; queueIndices?: number[] }) => void;
    _setProgress: (data: { position: number; duration: number }) => void;
    _persistState: () => void;
}

export const useAudioStore = create<AudioStoreState>((set, get) => ({
    currentTrack: initialTrack,
    queue: initialQueue,
    currentIndex: safeInitialIndex,
    isPlaying: false,
    isBuffering: false,
    position: initialPlayback.position,
    duration: initialPlayback.duration,
    shuffle: initialPlayback.shuffle,
    repeatMode: initialPlayback.repeatMode,
    equalizerPreset: initialPlayback.equalizerPreset,
    shuffledIndices: [],
    queueSource: initialPlayback.queueSource || 'Library',
    sleepTimerMode: 'off',
    sleepTimerRemaining: 0,

    playTrack: async (track: AudioTrack, newQueue?: AudioTrack[], queueSource?: string) => {
        const queue = newQueue && newQueue.length > 0 ? newQueue : [track];
        const index = queue.findIndex((t) => t.id === track.id);
        const startIndex = index >= 0 ? index : 0;
        const { shuffle, repeatMode, equalizerPreset } = get();
        const equalizerBands = getPresetBands(equalizerPreset);
        const source = queueSource ?? get().queueSource ?? 'Library';

        set({
            currentTrack: track,
            queue,
            currentIndex: startIndex,
            isPlaying: true,
            isBuffering: true,
            position: 0,
            duration: track.duration,
            queueSource: source,
        });

        // Save queue only when queue changes
        persistQueue(queue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.setQueue(queue, startIndex, 0, true, shuffle, repeatMode, equalizerBands);
            } catch (err) {
                console.error('[AudioStore] playTrack error:', err);
                set({ isPlaying: false, isBuffering: false });
            }
        }

        get()._persistState();

        if (!track.artworkUri && track.albumId) {
            AudioMediaService.getAlbumArt(track.albumId, track.uri).then((art) => {
                if (art && get().currentTrack?.id === track.id) {
                    set((prev) => ({
                        currentTrack: prev.currentTrack ? { ...prev.currentTrack, artworkUri: art } : null,
                    }));
                }
            });
        }
    },

    playQueue: async (queue: AudioTrack[], startIndex = 0, queueSource?: string) => {
        if (!queue || queue.length === 0) {return;}
        const safeIndex = Math.max(0, Math.min(startIndex, queue.length - 1));
        const track = queue[safeIndex];
        const { shuffle, repeatMode, equalizerPreset } = get();
        const equalizerBands = getPresetBands(equalizerPreset);
        const source = queueSource ?? get().queueSource ?? 'Library';

        set({
            currentTrack: track,
            queue,
            currentIndex: safeIndex,
            isPlaying: true,
            isBuffering: true,
            position: 0,
            duration: track.duration,
            queueSource: source,
        });

        persistQueue(queue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.setQueue(queue, safeIndex, 0, true, shuffle, repeatMode, equalizerBands);
            } catch (err) {
                console.error('[AudioStore] playQueue error:', err);
                set({ isPlaying: false, isBuffering: false });
            }
        }

        get()._persistState();

        if (!track.artworkUri && track.albumId) {
            AudioMediaService.getAlbumArt(track.albumId, track.uri).then((art) => {
                if (art && get().currentTrack?.id === track.id) {
                    set((prev) => ({
                        currentTrack: prev.currentTrack ? { ...prev.currentTrack, artworkUri: art } : null,
                    }));
                }
            });
        }
    },

    playNext: async (track: AudioTrack) => {
        const { queue, currentIndex } = get();
        if (queue.length === 0) {
            await get().playTrack(track);
            return;
        }
        const insertIndex = currentIndex + 1;
        const nextQueue = [...queue];
        nextQueue.splice(insertIndex, 0, track);
        set({ queue: nextQueue });
        persistQueue(nextQueue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.addMediaItem(insertIndex, track);
            } catch (err) {
                console.error('[AudioStore] playNext error:', err);
            }
        }
    },

    addToQueue: async (track: AudioTrack) => {
        const { queue } = get();
        if (queue.length === 0) {
            await get().playTrack(track);
            return;
        }
        const insertIndex = queue.length;
        const nextQueue = [...queue, track];
        set({ queue: nextQueue });
        persistQueue(nextQueue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.addMediaItem(insertIndex, track);
            } catch (err) {
                console.error('[AudioStore] addToQueue error:', err);
            }
        }
    },

    removeFromQueue: async (index: number) => {
        const { queue, currentIndex, position } = get();
        if (index < 0 || index >= queue.length) return;
        if (queue.length === 1) {
            await get().clearQueue();
            return;
        }

        const nextQueue = queue.filter((_, i) => i !== index);
        let nextIndex = currentIndex;
        let nextTrack = get().currentTrack;
        let nextPosition = position;

        if (index === currentIndex) {
            nextIndex = Math.min(currentIndex, nextQueue.length - 1);
            nextTrack = nextQueue[nextIndex];
            nextPosition = 0;
        } else if (index < currentIndex) {
            nextIndex = currentIndex - 1;
        }

        set({
            queue: nextQueue,
            currentIndex: nextIndex,
            currentTrack: nextTrack,
            position: nextPosition,
        });
        persistQueue(nextQueue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.removeMediaItem(index);
            } catch (err) {
                console.error('[AudioStore] removeFromQueue error:', err);
            }
        }
        get()._persistState();
    },

    moveQueueItem: async (fromIndex: number, toIndex: number) => {
        const { queue, currentIndex } = get();
        if (
            fromIndex < 0 ||
            fromIndex >= queue.length ||
            toIndex < 0 ||
            toIndex >= queue.length ||
            fromIndex === toIndex
        ) {
            return;
        }

        const nextQueue = [...queue];
        const [movedItem] = nextQueue.splice(fromIndex, 1);
        nextQueue.splice(toIndex, 0, movedItem);

        let nextIndex = currentIndex;
        if (currentIndex === fromIndex) {
            nextIndex = toIndex;
        } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
            nextIndex = currentIndex - 1;
        } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
            nextIndex = currentIndex + 1;
        }

        set({
            queue: nextQueue,
            currentIndex: nextIndex,
        });
        persistQueue(nextQueue);

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.moveMediaItem(fromIndex, toIndex);
            } catch (err) {
                console.error('[AudioStore] moveQueueItem error:', err);
            }
        }
        get()._persistState();
    },

    setSleepTimer: async (option: number | 'end_of_track' | 'off') => {
        clearSleepTimerInterval();
        const audioModule = getAudioModule();
        if (option === 'off') {
            set({ sleepTimerMode: 'off', sleepTimerRemaining: 0 });
            if (Platform.OS === 'android' && audioModule) {
                try {
                    await audioModule.clearSleepTimer();
                } catch (err) {
                    console.error('[AudioStore] clearSleepTimer error:', err);
                }
            }
            return;
        }
        if (option === 'end_of_track') {
            set({ sleepTimerMode: 'end_of_track', sleepTimerRemaining: 0 });
            if (Platform.OS === 'android' && audioModule) {
                try {
                    await audioModule.setSleepTimer(0, true);
                } catch (err) {
                    console.error('[AudioStore] setSleepTimer error:', err);
                }
            }
            return;
        }
        const totalSecs = option * 60;
        const endTime = Date.now() + totalSecs * 1000;
        set({ sleepTimerMode: 'time', sleepTimerRemaining: totalSecs });
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.setSleepTimer(option, false);
            } catch (err) {
                console.error('[AudioStore] setSleepTimer error:', err);
            }
        }
        sleepTimerInterval = setInterval(() => {
            const remaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));
            if (remaining <= 0) {
                clearSleepTimerInterval();
                set({ sleepTimerMode: 'off', sleepTimerRemaining: 0 });
            } else {
                set({ sleepTimerRemaining: remaining });
            }
        }, 1000);
    },

    togglePlayPause: async () => {
        const { isPlaying, currentTrack, queue, currentIndex, position, shuffle, repeatMode, equalizerPreset } = get();
        if (!currentTrack) {
            if (queue.length > 0) {
                await get().playQueue(queue, currentIndex);
            }
            return;
        }

        if (isPlaying) {
            await get().pause();
        } else {
            const audioModule = getAudioModule();
            if (Platform.OS === 'android' && audioModule) {
                try {
                    const state = await audioModule.getCurrentState();
                    if (!state.trackId && queue.length > 0) {
                        const equalizerBands = getPresetBands(equalizerPreset);
                        await audioModule.setQueue(queue, currentIndex, position, true, shuffle, repeatMode, equalizerBands);
                        set({ isPlaying: true });
                        return;
                    }
                } catch {
                    // Fall through
                }
            }
            await get().play();
        }
    },

    play: async () => {
        set({ isPlaying: true });
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.play();
            } catch (err) {
                console.error('[AudioStore] play error:', err);
                set({ isPlaying: false });
            }
        }
    },

    pause: async () => {
        set({ isPlaying: false });
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.pause();
            } catch (err) {
                console.error('[AudioStore] pause error:', err);
            }
        }
        get()._persistState();
    },

    seekTo: async (seconds: number) => {
        set({ position: seconds });
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.seekTo(seconds);
            } catch (err) {
                console.error('[AudioStore] seekTo error:', err);
            }
        }
        get()._persistState();
    },

    skipNext: async () => {
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.skipToNext();
            } catch (err) {
                console.error('[AudioStore] skipNext error:', err);
            }
        }
    },

    skipPrevious: async () => {
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.skipToPrevious();
            } catch (err) {
                console.error('[AudioStore] skipPrevious error:', err);
            }
        }
    },

    skipToIndex: async (index: number) => {
        const { queue } = get();
        if (index < 0 || index >= queue.length) {return;}
        const track = queue[index];

        set({
            currentIndex: index,
            currentTrack: track,
            position: 0,
            duration: track.duration,
            isPlaying: true,
        });

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.skipToIndex(index);
            } catch (err) {
                console.error('[AudioStore] skipToIndex error:', err);
            }
        }

        get()._persistState();
    },

    toggleShuffle: async () => {
        const next = !get().shuffle;
        set({ shuffle: next });
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.setShuffleMode(next);
            } catch (err) {
                console.error('[AudioStore] toggleShuffle error:', err);
            }
        }
        get()._persistState();
    },

    toggleRepeatMode: async () => {
        const current = get().repeatMode;
        const modes: AudioRepeatMode[] = ['off', 'all', 'one'];
        const nextIndex = (modes.indexOf(current) + 1) % modes.length;
        const next = modes[nextIndex];
        set({ repeatMode: next });

        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.setRepeatMode(next);
            } catch (err) {
                console.error('[AudioStore] toggleRepeatMode error:', err);
            }
        }
        get()._persistState();
    },

    setAudioEqualizer: async (bands: number[]) => {
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.setAudioEqualizer(bands);
            } catch (err) {
                console.error('[AudioStore] setAudioEqualizer error:', err);
            }
        }
    },

    setEqualizerPreset: async (presetId: string) => {
        set({ equalizerPreset: presetId });
        const bands = getPresetBands(presetId);
        if (bands) {
            await get().setAudioEqualizer(bands);
        }
        get()._persistState();
    },

    clearQueue: async () => {
        set({
            currentTrack: null,
            queue: [],
            currentIndex: 0,
            isPlaying: false,
            position: 0,
            duration: 0,
            shuffledIndices: [],
        });
        persistQueue([]);
        const audioModule = getAudioModule();
        if (Platform.OS === 'android' && audioModule) {
            try {
                await audioModule.stop();
            } catch {
                // ignore
            }
        }
        get()._persistState();
    },

    _setPlaybackState: (state) => {
        set((prev) => ({
            isPlaying: state.isPlaying,
            isBuffering: state.isBuffering,
            position: state.position !== undefined ? state.position : prev.position,
            duration: state.duration !== undefined && state.duration > 0 ? state.duration : prev.duration,
        }));
    },

    _setTrackChanged: (data) => {
        const { queue, currentTrack } = get();
        const nextIndex = data.currentIndex;
        if (nextIndex >= 0 && nextIndex < queue.length) {
            const nextTrack = queue[nextIndex];
            const hasTrackChanged = data.trackId ? data.trackId !== currentTrack?.id : nextTrack.id !== currentTrack?.id;

            set((prev) => ({
                currentIndex: nextIndex,
                currentTrack: nextTrack,
                // Only reset position to 0 when the playing song actually changes, not when its index shifts from queue edits
                position: hasTrackChanged ? 0 : prev.position,
                duration: data.duration && data.duration > 0 ? data.duration : nextTrack.duration,
                shuffledIndices: data.queueIndices ?? prev.shuffledIndices,
            }));
            get()._persistState();

            if (!nextTrack.artworkUri && nextTrack.albumId) {
                AudioMediaService.getAlbumArt(nextTrack.albumId, nextTrack.uri).then((art) => {
                    if (art && get().currentTrack?.id === nextTrack.id) {
                        set((prev) => ({
                            currentTrack: prev.currentTrack ? { ...prev.currentTrack, artworkUri: art } : null,
                        }));
                    }
                });
            }
        }
    },

    _setProgress: (data) => {
        set((prev) => ({
            position: data.position,
            duration: data.duration > 0 ? data.duration : prev.duration,
        }));
    },

    _persistState: () => {
        const { currentIndex, position, duration, shuffle, repeatMode, equalizerPreset, queueSource } = get();
        // Persist only lightweight playback state (~100 bytes) on regular state transitions
        schedulePersistPlayback({
            currentIndex,
            position,
            duration,
            shuffle,
            repeatMode,
            equalizerPreset,
            queueSource,
        });
    },
}));

// Setup native device event listeners
if (Platform.OS === 'android') {
    DeviceEventEmitter.addListener('onAudioPlaybackStateChanged', (event) => {
        useAudioStore.getState()._setPlaybackState({
            isPlaying: !!event.isPlaying,
            isBuffering: !!event.isBuffering,
            position: typeof event.position === 'number' ? event.position : undefined,
            duration: typeof event.duration === 'number' ? event.duration : undefined,
        });
    });

    DeviceEventEmitter.addListener('onAudioTrackChanged', (event) => {
        useAudioStore.getState()._setTrackChanged({
            currentIndex: event.currentIndex ?? 0,
            trackId: event.trackId,
            duration: event.duration,
            queueIndices: Array.isArray(event.queueIndices) ? event.queueIndices : undefined,
        });
    });

    DeviceEventEmitter.addListener('onAudioProgress', (event) => {
        useAudioStore.getState()._setProgress({
            position: event.position ?? 0,
            duration: event.duration ?? 0,
        });
    });

    DeviceEventEmitter.addListener('onAudioError', () => {
        useAudioStore.getState()._setPlaybackState({ isPlaying: false, isBuffering: false });
    });

    DeviceEventEmitter.addListener('onSleepTimerFired', () => {
        clearSleepTimerInterval();
        useAudioStore.setState({ sleepTimerMode: 'off', sleepTimerRemaining: 0 });
    });
}

// Recents > Music. One place catches every way a song starts: a tap, skip, auto-advance or
// the notification controls. The song restored at launch is not a change, so it is not counted.
useAudioStore.subscribe((state, prev) => {
    const id = state.currentTrack?.id;
    if (id && id !== prev.currentTrack?.id) {
        useMusicHistoryStore.getState().recordPlay(id);
    }
});
