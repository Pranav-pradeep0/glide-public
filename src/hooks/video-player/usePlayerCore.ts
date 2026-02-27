/**
 * usePlayerCore Hook
 */


import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VLCPlayer } from '@glide/vlc-player';
import { useSharedValue, useFrameCallback } from 'react-native-reanimated';
import {
    PlayerState,
    VLCLoadData,
    VLCProgressData,
    VLCSeekEvent,
    VLCBufferingEvent,
    UsePlayerCoreReturn,
    PLAYER_CONSTANTS,
    formatTime,
} from './types';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/** Minimum ms between live preview seeks while scrubbing. */
const LIVE_PREVIEW_THROTTLE_MS = 80;

// ─── INITIAL STATE ────────────────────────────────────────────────────────────

const initialPlayerState: PlayerState = {
    paused: false,
    duration: 0,
    currentTime: 0,
    isVideoLoaded: false,
    isPlaying: false,
    isBuffering: false,
    isSeeking: false,
    playerStopped: false,
    errorText: null,
};

// ─── HOOK OPTIONS ─────────────────────────────────────────────────────────────

interface UsePlayerCoreOptions {
    videoPath: string;
    onAudioTracksLoaded?: (tracks: Array<{ id: number; name: string }>) => void;
    onPlaybackPositionRestore?: (position: number) => void;
    getResumePosition?: () => number | null;
    repeat?: boolean;
    sleepTimer?: number | null;
    onSleepTimerEnd?: () => void;
    onProgressSave?: () => void;
    initialPaused?: boolean;
    playbackRate?: number;
}

// ─── HOOK ─────────────────────────────────────────────────────────────────────

export function usePlayerCore(options: UsePlayerCoreOptions): UsePlayerCoreReturn {
    const {
        onAudioTracksLoaded,
        getResumePosition,
        repeat = false,
        sleepTimer = null,
        onSleepTimerEnd,
        onProgressSave,
        initialPaused = false,
    } = options;

    // ── REFS ─────────────────────────────────────────────────────────────────

    const videoRef = useRef<VLCPlayer | null>(null);

    // Time tracking — refs are source of truth; state drives display only
    const currentTimeRef = useRef<number>(0);
    const lastDisplayUpdateRef = useRef<number>(0);

    // Resume position (cleared after first use)
    const resumePosRef = useRef<number | null>(getResumePosition?.() ?? null);

    // Buffering debounce
    const bufferingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Live preview throttle
    const livePreviewTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastLivePreviewAtRef = useRef<number>(0);

    // Seek settling
    const seekSettledUntilRef = useRef<number>(0);

    // Player stopped flag
    const playerStoppedRef = useRef<boolean>(false);

    // ── STATE ─────────────────────────────────────────────────────────────────

    const [state, setState] = useState<PlayerState>({
        ...initialPlayerState,
        paused: initialPaused,
    });

    // ── SHARED VALUES (Reanimated gesture worklets) ───────────────────────────

    const currentTimeShared = useSharedValue(0);
    const durationShared = useSharedValue(0);
    const isScrubbingShared = useSharedValue(false);

    const isPlayingShared = useSharedValue(false);
    const lastSyncTimestamp = useSharedValue(0);
    const lastSyncPosition = useSharedValue(0);
    const playbackRateShared = useSharedValue(options.playbackRate ?? 1.0);

    useEffect(() => {
        playbackRateShared.value = options.playbackRate ?? 1.0;
    }, [options.playbackRate, playbackRateShared]);

    // ── FRAME CALLBACK ────────────────────────────────────────────────────────

    useFrameCallback(() => {
        if (isPlayingShared.value && !isScrubbingShared.value && durationShared.value > 0) {
            const now = Date.now();
            const elapsed = (now - lastSyncTimestamp.value) / 1000;
            let predicted = lastSyncPosition.value + elapsed * playbackRateShared.value;
            if (predicted > durationShared.value) predicted = durationShared.value;
            currentTimeShared.value = predicted;
        }
    });

    // ── DERIVED VALUES ────────────────────────────────────────────────────────

    const displayTime = useMemo(() => state.currentTime, [state.currentTime]);
    const formattedTime = useMemo(() => formatTime(displayTime), [displayTime]);
    const formattedDuration = useMemo(() => formatTime(state.duration), [state.duration]);

    // ═════════════════════════════════════════════════════════════════════════
    // SEEK IMPLEMENTATION
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * applySeekToVLC — the single exit point for all seeks to native.
     * Simplified: no JS-side dedup (native bridge handles dedup).
     */
    const applySeekToVLC = useCallback((timeInSeconds: number) => {
        if (!state.isVideoLoaded || !state.duration || state.duration === 0) {
            if (__DEV__) console.log('[SEEK] applySeekToVLC skipped — not loaded or no duration');
            return;
        }

        const clamped = Math.max(0, Math.min(state.duration, timeInSeconds));
        const fraction = Math.max(0, Math.min(1, clamped / state.duration));

        const player = videoRef.current;
        if (player && typeof player.seek === 'function') {
            if (__DEV__) console.log('[SEEK] applySeekToVLC fraction=' + fraction.toFixed(4)
                + ' time=' + clamped.toFixed(2) + 's');
            player.seek(fraction);
            // Reset the native seek prop to -1 immediately so React re-renders
            // don't re-send the same value (which causes SEEK_FILTER log spam).
            player.seek(-1);
        } else if (__DEV__) {
            console.warn('[SEEK] applySeekToVLC — no player instance');
        }
    }, [state.isVideoLoaded, state.duration]);

    /**
     * previewSeek — called continuously while the user drags the seekbar.
     * Updates UI refs immediately; throttles native seeks.
     */
    const previewSeek = useCallback((timeInSeconds: number) => {
        const clamped = Math.max(0, Math.min(state.duration || 0, timeInSeconds));

        currentTimeRef.current = clamped;
        currentTimeShared.value = clamped;
        lastSyncPosition.value = clamped;
        lastSyncTimestamp.value = Date.now();

        const now = Date.now();
        const sinceLast = now - lastLivePreviewAtRef.current;

        if (sinceLast >= LIVE_PREVIEW_THROTTLE_MS) {
            if (__DEV__) console.log('[SEEK] previewSeek immediate t=' + clamped.toFixed(2) + 's');
            applySeekToVLC(clamped);
            lastLivePreviewAtRef.current = now;
            if (livePreviewTimerRef.current) {
                clearTimeout(livePreviewTimerRef.current);
                livePreviewTimerRef.current = null;
            }
        } else {
            if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
            const wait = LIVE_PREVIEW_THROTTLE_MS - sinceLast;
            if (__DEV__) console.log('[SEEK] previewSeek deferred t=' + clamped.toFixed(2) + 's waitMs=' + wait);
            livePreviewTimerRef.current = setTimeout(() => {
                livePreviewTimerRef.current = null;
                lastLivePreviewAtRef.current = Date.now();
                applySeekToVLC(clamped);
            }, wait);
        }
    }, [state.duration, currentTimeShared, lastSyncPosition, lastSyncTimestamp, applySeekToVLC]);


    const commitSeek = useCallback((timeInSeconds: number) => {
        if (__DEV__) console.log('[SEEK] commitSeek requested t=' + timeInSeconds.toFixed(2) + 's'
            + ' playerStopped=' + state.playerStopped
            + ' isPaused=' + state.paused);

        if (livePreviewTimerRef.current) {
            clearTimeout(livePreviewTimerRef.current);
            livePreviewTimerRef.current = null;
        }

        const duration = state.duration || 0;
        const clamped = Math.max(0, Math.min(duration, timeInSeconds));

        if (__DEV__) console.log('[SEEK] commitSeek final t=' + clamped.toFixed(2) + 's');

        currentTimeRef.current = clamped;
        currentTimeShared.value = clamped;
        lastSyncPosition.value = clamped;
        lastSyncTimestamp.value = Date.now();
        lastLivePreviewAtRef.current = Date.now();

        applySeekToVLC(clamped);

        seekSettledUntilRef.current = Date.now() + 500

        setState(prev => ({
            ...prev,
            currentTime: clamped,
            isSeeking: false,
            // When reviving from stopped/ended state, also clear paused so React
            // doesn't re-send paused=true to native and immediately pause the
            // newly-created player.
            ...(prev.playerStopped
                ? { playerStopped: false, paused: false, isPlaying: true }
                : {}),
        }));

        if (state.playerStopped) {
            isPlayingShared.value = true;
            if (__DEV__) console.log('[SEEK] commitSeek: reviving from stopped state');
        }

        isScrubbingShared.value = false;
    }, [state.duration, state.playerStopped, state.paused, applySeekToVLC, currentTimeShared,
        lastSyncPosition, lastSyncTimestamp, isScrubbingShared, isPlayingShared]);

    /** setIsSeeking — marks scrub start/end for UI feedback. */
    const setIsSeeking = useCallback((seeking: boolean) => {
        isScrubbingShared.value = seeking;
        setState(prev => ({ ...prev, isSeeking: seeking }));
        if (__DEV__) console.log('[SEEK] setIsSeeking=' + seeking);
    }, [isScrubbingShared]);

    /** clearResumePosition — prevents handleLoad from restoring the saved position. */
    const clearResumePosition = useCallback(() => {
        resumePosRef.current = null;
        if (__DEV__) console.log('[SEEK] clearResumePosition');
    }, []);

    // ═════════════════════════════════════════════════════════════════════════
    // PLAYBACK CONTROLS
    // ═════════════════════════════════════════════════════════════════════════

    const play = useCallback(() => {
        playerStoppedRef.current = false;
        isPlayingShared.value = true;

        // Always reset to 0 when playerStopped (video ended), regardless of currentTime drift
        if (state.playerStopped) {
            currentTimeRef.current = 0;
            currentTimeShared.value = 0;
            lastSyncPosition.value = 0;
            lastSyncTimestamp.value = Date.now();
        }
        // Keep the existing "near end" check as secondary guard
        else if (state.duration > 0 && Math.abs(currentTimeRef.current - state.duration) < 1.0) {
            currentTimeRef.current = 0;
            currentTimeShared.value = 0;
            lastSyncPosition.value = 0;
            lastSyncTimestamp.value = Date.now();
        }

        setState(prev => ({
            ...prev,
            paused: false,
            isPlaying: true,
            playerStopped: false,
        }));
    }, [state.playerStopped, state.duration, currentTimeShared, isPlayingShared,
        lastSyncPosition, lastSyncTimestamp]);

    const pause = useCallback(() => {
        if (__DEV__) console.log('[CONTROL] pause() | currentTime=' + currentTimeRef.current.toFixed(2));

        isPlayingShared.value = false;

        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
        }));

        onProgressSave?.();
    }, [onProgressSave, isPlayingShared]);

    const stop = useCallback(() => {
        if (__DEV__) console.log('[CONTROL] stop()');

        videoRef.current?.stopPlayer?.();
        isPlayingShared.value = false;

        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true,
        }));
    }, [isPlayingShared]);

    const togglePlayPause = useCallback(() => {
        if (__DEV__) console.log('[CONTROL] togglePlayPause | paused=' + state.paused);
        if (state.paused) play(); else pause();
    }, [state.paused, play, pause]);

    // ═════════════════════════════════════════════════════════════════════════
    // VLC EVENT HANDLERS
    // ═════════════════════════════════════════════════════════════════════════

    const handleLoad = useCallback((data: VLCLoadData) => {
        const durationSec = (data.duration ?? 0) / 1000;

        if (durationSec <= 1) {
            if (__DEV__) console.log('[LOAD] ignored — junk duration=' + durationSec + 's');
            return;
        }

        if (__DEV__) console.log('[LOAD] duration=' + durationSec.toFixed(2) + 's'
            + ' audioTracks=' + (data.audioTracks?.length ?? 0));

        setState(prev => ({
            ...prev,
            duration: durationSec,
            isVideoLoaded: true,
            playerStopped: false,
            errorText: null,
        }));

        durationShared.value = durationSec;


        if (data.audioTracks && data.audioTracks.length > 0 && onAudioTracksLoaded) {
            const tracks = data.audioTracks
                .filter(t => t.id !== -1)
                .map(t => ({ id: t.id, name: t.name || `Track ${t.id}` }));
            if (__DEV__) console.log('[LOAD] audioTracks:', tracks.map(t => t.name).join(', '));
            onAudioTracksLoaded(tracks);
        }

        const resumeTime = resumePosRef.current;
        if (resumeTime && resumeTime > 0 && resumeTime < durationSec - 1) {
            if (__DEV__) console.log('[LOAD] applying resume position=' + resumeTime.toFixed(2) + 's');

            currentTimeRef.current = resumeTime;
            currentTimeShared.value = resumeTime;
            lastSyncPosition.value = resumeTime;
            lastSyncTimestamp.value = Date.now();
            resumePosRef.current = null;

            setState(prev => ({ ...prev, currentTime: resumeTime }));

            // Direct seek — applySeekToVLC can't be used here because
            // state.isVideoLoaded is stale in its closure.
            setTimeout(() => {
                const fraction = resumeTime / durationSec;
                if (__DEV__) console.log('[SEEK] resume seek fraction=' + fraction.toFixed(4));
                videoRef.current?.seek(fraction);
                videoRef.current?.seek(-1); // Reset to prevent re-render spam
            }, 100);
        }
    }, [onAudioTracksLoaded, durationShared, currentTimeShared, lastSyncPosition,
        lastSyncTimestamp]);

    /**
     * handleProgress — VLC position update during playback.
     */
    const handleProgress = useCallback((data: VLCProgressData) => {
        if (isScrubbingShared.value) return;
        if (playerStoppedRef.current) return;

        const timeSec = (data.currentTime ?? 0) / 1000;
        const durSec = (data.duration ?? 0) / 1000;

        if (durSec <= 1) return;

        currentTimeRef.current = timeSec;

        const now = Date.now();

        if (now < seekSettledUntilRef.current) {
            // Still in seek settlement window — update display state but
            // do NOT overwrite lastSyncPosition (which holds the committed seek target)
            const shouldUpdate = (now - lastDisplayUpdateRef.current) > PLAYER_CONSTANTS.DISPLAY_TIME_UPDATE_INTERVAL;
            if (shouldUpdate) {
                lastDisplayUpdateRef.current = now;
                setState(prev => {
                    const timeChanged = Math.abs(timeSec - prev.currentTime) > 0.1;
                    if (!timeChanged) return prev;
                    return { ...prev, currentTime: timeSec };
                });
            }
            return;
        }

        const elapsed = (now - lastSyncTimestamp.value) / 1000;
        const predicted = lastSyncPosition.value + elapsed * playbackRateShared.value;
        const drift = Math.abs(timeSec - predicted);

        if (drift > 1.0 || !isPlayingShared.value) {
            if (__DEV__ && drift > 1.0) console.log('[SYNC] drift=' + drift.toFixed(2) + 's → resyncing');
            lastSyncPosition.value = timeSec;
            lastSyncTimestamp.value = now;
            if (drift > 2.0) currentTimeShared.value = timeSec;
        }

        if (!state.paused && !isPlayingShared.value) {
            if (__DEV__) console.log('[PROGRESS] waking up isPlayingShared');
            isPlayingShared.value = true;
            lastSyncTimestamp.value = now;
            lastSyncPosition.value = timeSec;
        }

        const shouldUpdate = (now - lastDisplayUpdateRef.current) > PLAYER_CONSTANTS.DISPLAY_TIME_UPDATE_INTERVAL;
        if (shouldUpdate) {
            lastDisplayUpdateRef.current = now;
            setState(prev => {
                const timeChanged = Math.abs(timeSec - prev.currentTime) > 0.1;
                const durChanged = Math.abs(durSec - prev.duration) > 1.0;
                if (!timeChanged && !durChanged) return prev;
                return {
                    ...prev,
                    currentTime: timeSec,
                    duration: durChanged ? durSec : prev.duration,
                };
            });
        }
    }, [currentTimeShared, isScrubbingShared, lastSyncPosition, lastSyncTimestamp,
        isPlayingShared, state.paused, playbackRateShared]);

    /**
     * handleEnd — video reached end.
     */

    const handleEnd = useCallback(() => {
        if (__DEV__) console.log('[END] video ended | repeat=' + repeat + ' sleepTimer=' + sleepTimer);

        if (repeat) {
            videoRef.current?.seek(0);
            currentTimeRef.current = 0;
            currentTimeShared.value = 0;
            lastSyncPosition.value = 0;
            lastSyncTimestamp.value = Date.now();
            setState(prev => ({ ...prev, currentTime: 0, isPlaying: true }));
            if (__DEV__) console.log('[END] repeating from start');
            return;
        }

        if (sleepTimer === -1) {
            if (__DEV__) console.log('[END] sleep timer triggered');
            onSleepTimerEnd?.();
        }

        const endTime = state.duration;
        playerStoppedRef.current = true;
        isPlayingShared.value = false;
        currentTimeShared.value = endTime;
        currentTimeRef.current = endTime;

        setState(prev => ({
            ...prev,
            paused: true,
            currentTime: prev.duration,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true,
        }));

        onProgressSave?.();
        if (__DEV__) console.log('[END] playerStopped=true');
    }, [repeat, sleepTimer, onSleepTimerEnd, onProgressSave, state.duration,
        currentTimeShared, lastSyncPosition, lastSyncTimestamp, isPlayingShared]);

    /**
     * handleError — VLC error.
     */
    const handleError = useCallback((e: any) => {
        const msg = e?.error || e?.message || 'Playback error';
        if (__DEV__) console.error('[ERROR] VLC error:', e);
        isPlayingShared.value = false;
        setState(prev => ({ ...prev, errorText: String(msg), isBuffering: false }));
    }, [isPlayingShared]);

    /**
     * handleBuffering — debounced buffering state.
     */
    const handleBuffering = useCallback((event: VLCBufferingEvent | any) => {
        const isBuffering = typeof event === 'boolean'
            ? event
            : (event?.isBuffering ?? false);

        if (__DEV__) console.log('[PROGRESS] buffering=' + isBuffering);

        if (bufferingTimeoutRef.current) clearTimeout(bufferingTimeoutRef.current);

        if (isBuffering) {
            setState(prev => ({ ...prev, isBuffering: true }));
        } else {
            bufferingTimeoutRef.current = setTimeout(() => {
                setState(prev => ({ ...prev, isBuffering: false }));
            }, PLAYER_CONSTANTS.BUFFERING_TIMEOUT_MS);
        }
    }, []);

    const handlePlaying = useCallback(() => {
        if (isScrubbingShared.value) {
            if (__DEV__) console.log('[PLAYING] handlePlaying skipped — scrubbing');
            return;
        }

        if (__DEV__) console.log('[PLAYING] handlePlaying | isPaused=' + state.paused
            + ' isPlaying=' + state.isPlaying);

        const now = Date.now();
        isPlayingShared.value = true;
        lastSyncTimestamp.value = now;
        lastSyncPosition.value = currentTimeRef.current;

        setState(prev => {
            if (prev.isPlaying && !prev.paused) return prev; // already correct
            return {
                ...prev,
                isPlaying: true,
                paused: false,
                isBuffering: false,
                playerStopped: false,
            };
        });
    }, [isPlayingShared, lastSyncTimestamp, lastSyncPosition, isScrubbingShared,
        state.paused, state.isPlaying]);

    const handlePaused = useCallback(() => {
        if (isScrubbingShared.value) {
            if (__DEV__) console.log('[PLAYING] handlePaused skipped — scrubbing');
            return;
        }

        if (__DEV__) console.log('[PLAYING] handlePaused | isPaused=' + state.paused
            + ' isPlaying=' + state.isPlaying);

        isPlayingShared.value = false;

        setState(prev => {
            if (!prev.isPlaying && prev.paused) return prev; // already correct
            return { ...prev, isPlaying: false, paused: true };
        });

        onProgressSave?.();
    }, [onProgressSave, isPlayingShared, isScrubbingShared, state.paused, state.isPlaying]);

    /**
     * handleStopped — VLC native Stopped event.
     */
    const handleStopped = useCallback(() => {
        if (__DEV__) console.log('[PLAYING] handleStopped');

        playerStoppedRef.current = true;
        isPlayingShared.value = false;

        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true,
        }));
    }, [isPlayingShared]);

    /**
     * handleSeek — VLC native seek position change (e.g. from notification controls).
     */
    const handleSeek = useCallback((data: VLCSeekEvent) => {
        if (isScrubbingShared.value) return;

        const timeSec = (data.currentTime ?? 0) / 1000;
        const durSec = (data.duration ?? 0) / 1000;

        if (durSec <= 1) return;

        if (__DEV__) console.log('[SEEK] handleSeek (native) t=' + timeSec.toFixed(2) + 's');

        currentTimeRef.current = timeSec;
        currentTimeShared.value = timeSec;
        lastSyncPosition.value = timeSec;
        lastSyncTimestamp.value = Date.now();

        setState(prev => ({ ...prev, currentTime: timeSec, duration: durSec }));

        onProgressSave?.();
    }, [currentTimeShared, onProgressSave, lastSyncPosition, lastSyncTimestamp, isScrubbingShared]);

    // ── CLEANUP ───────────────────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            if (bufferingTimeoutRef.current) clearTimeout(bufferingTimeoutRef.current);
            if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
        };
    }, []);

    // ── RETURN ────────────────────────────────────────────────────────────────

    return useMemo(() => ({
        videoRef,
        currentTimeRef,
        state,
        currentTimeShared,
        durationShared,
        isScrubbingShared,
        play,
        pause,
        stop,
        togglePlayPause,
        previewSeek,
        commitSeek,
        setIsSeeking,
        clearResumePosition,
        handleLoad,
        handleProgress,
        handleEnd,
        handleError,
        handleBuffering,
        handlePlaying,
        handlePaused,
        handleStopped,
        handleSeek,
        displayTime,
        formattedTime,
        formattedDuration,
    }), [
        videoRef, currentTimeRef, state,
        currentTimeShared, durationShared, isScrubbingShared,
        play, pause, stop, togglePlayPause,
        previewSeek, commitSeek, setIsSeeking, clearResumePosition,
        handleLoad, handleProgress, handleEnd, handleError,
        handleBuffering, handlePlaying, handlePaused, handleStopped, handleSeek,
        displayTime, formattedTime, formattedDuration,
    ]);
}

export default usePlayerCore;
export { initialPlayerState };
