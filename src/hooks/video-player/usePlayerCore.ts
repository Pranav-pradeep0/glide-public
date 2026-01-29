/**
 * usePlayerCore Hook
 * 
 * The core hook for video player state management.
 * Handles all VLC player interactions, seek logic, and time tracking.
 * 
 * CRITICAL: This hook manages seeking and progress - be very careful when modifying.
 * Seek logic is particularly sensitive and can easily break if not handled properly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VLCPlayer } from 'react-native-vlc-media-player';
import { useSharedValue, useFrameCallback, runOnJS } from 'react-native-reanimated';
import {
    PlayerState,
    VLCLoadData,
    VLCProgressData,
    VLCSeekEvent,
    VLCBufferingEvent,
    UsePlayerCoreReturn,
    PLAYER_CONSTANTS,
    formatTime,
    createDebounce,
} from './types';

// ============================================================================
// INITIAL STATE
// ============================================================================

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
    seekFraction: null,
};

// ============================================================================
// HOOK OPTIONS
// ============================================================================

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

// ============================================================================
// HOOK
// ============================================================================

/**
 * Core hook for VLC player state management.
 * 
 * This hook is responsible for:
 * - VLC player ref management
 * - Playback state (paused, playing, stopped, buffering)
 * - Time tracking with ref-first approach for performance
 * - Seeking with debouncing and fraction-based VLC control
 * - VLC event handling
 * 
 * IMPORTANT: Time tracking uses a ref as the source of truth (currentTimeRef).
 * State (currentTime) is only updated at display intervals to minimize re-renders.
 * Gestures and worklets should use currentTimeShared for direct access.
 */
export function usePlayerCore(options: UsePlayerCoreOptions): UsePlayerCoreReturn {
    const {
        videoPath,
        onAudioTracksLoaded,
        getResumePosition,
        repeat = false,
        sleepTimer = null,
        onSleepTimerEnd,
        onProgressSave,
        initialPaused = false
    } = options;

    // ========================================================================
    // REFS (Source of truth for high-frequency values)
    // ========================================================================

    const videoRef = useRef<VLCPlayer | null>(null);

    // Time tracking - ref is source of truth, state is for display only
    const currentTimeRef = useRef<number>(0);
    const lastDisplayUpdateRef = useRef<number>(0);

    // Seek tracking
    const lastAppliedSeekRef = useRef<number>(0);

    // Resume position
    const resumePosRef = useRef<number | null>(getResumePosition?.() ?? null);

    // Buffering debounce
    const bufferingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Track when scrubbing ends to ignore stale progress
    const scrubEndTimeRef = useRef<number>(0);

    // Guard against VLC rapid play/pause oscillation
    // VLC can emit rapid onPlaying/onPaused events that create a feedback loop
    const lastPlayPauseEventRef = useRef<{ type: 'play' | 'pause'; time: number } | null>(null);
    const PLAY_PAUSE_DEBOUNCE_MS = 100; // Ignore events within 100ms of opposite event

    // ========================================================================
    // STATE
    // ========================================================================

    const [state, setState] = useState<PlayerState>({
        ...initialPlayerState,
        paused: initialPaused
    });

    // ========================================================================
    // SHARED VALUES (for gesture worklets)
    // ========================================================================

    const currentTimeShared = useSharedValue(0);
    const durationShared = useSharedValue(0);
    const isScrubbingShared = useSharedValue(false);

    // SMOOTH SEEKBAR: Sync values for interpolation
    const isPlayingShared = useSharedValue(false);
    const lastSyncTimestamp = useSharedValue(0);
    const lastSyncPosition = useSharedValue(0);
    const playbackRateShared = useSharedValue(options.playbackRate ?? 1.0);

    // Sync playback rate shared value
    useEffect(() => {
        playbackRateShared.value = options.playbackRate ?? 1.0;
    }, [options.playbackRate, playbackRateShared]);

    // ========================================================================
    // FRAME CALLBACK (SMOOTH INTERPOLATION)
    // ========================================================================

    useFrameCallback(() => {
        // Only interpolate if playing and NOT scrubbing
        if (isPlayingShared.value && !isScrubbingShared.value && durationShared.value > 0) {
            const now = Date.now();
            const elapsedSeconds = (now - lastSyncTimestamp.value) / 1000;

            // Predict current time based on last known position + elapsed time * speed
            let nextTime = lastSyncPosition.value + (elapsedSeconds * playbackRateShared.value);

            // Clamp to duration
            if (nextTime > durationShared.value) nextTime = durationShared.value;

            currentTimeShared.value = nextTime;
        }
    });

    // ========================================================================
    // DERIVED VALUES
    // ========================================================================

    /**
     * Display time - uses seek time during seeking, otherwise current time.
     * This prevents jumpy display during seek operations.
     */
    const displayTime = useMemo(() => {
        if (state.isSeeking) {
            // During seeking, calculate time from seekFraction if available
            if (state.seekFraction !== null && state.duration > 0) {
                return state.seekFraction * state.duration;
            }
        }
        return state.currentTime;
    }, [state.isSeeking, state.seekFraction, state.duration, state.currentTime]);

    const formattedTime = useMemo(() => formatTime(displayTime), [displayTime]);
    const formattedDuration = useMemo(() => formatTime(state.duration), [state.duration]);

    // ========================================================================
    // SEEK IMPLEMENTATION (CRITICAL - Handle with care)
    // ========================================================================

    /**
     * Apply seek to VLC player.
     * Uses fraction-based seeking (0-1) which VLC expects.
     * 
     * IMPORTANT: Only uses the native seek method (playerInstance.seek)
     * Native VLC guard prevents repeated seeks to same position.
     */
    const applySeekToVLC = useCallback((timeInSeconds: number) => {
        if (!state.isVideoLoaded || !state.duration || state.duration === 0) {
            // Video not ready to seek
            return;
        }

        // Clamp time to valid range
        const clamped = Math.max(0, Math.min(state.duration, timeInSeconds));

        // Calculate fraction (0-1)
        const fraction = Math.max(0, Math.min(1, clamped / state.duration));

        // Call native seek method directly
        // Native VLC guard prevents repeated seeks to same position
        const playerInstance = videoRef.current;
        if (playerInstance && typeof playerInstance.seek === 'function') {
            playerInstance.seek(fraction);
            // Seek applied

        } else if (__DEV__) {
            console.warn('[usePlayerCore] Cannot seek - no player instance');
        }
    }, [state.isVideoLoaded, state.duration]);

    /**
     * Debounced seek - used during continuous drag to prevent overwhelming VLC.
     * Batches rapid seek requests and only applies the final one.
     */
    const debouncedSeek = useMemo(
        () => createDebounce(applySeekToVLC, PLAYER_CONSTANTS.SEEK_DEBOUNCE_MS),
        [applySeekToVLC]
    );

    /**
     * Perform seek with debouncing.
     * Updates time refs/state immediately for responsive UI,
     * but debounces the actual VLC seek call.
     * 
     * SIMPLIFIED: Native VLC guard prevents repeated seeks to same position,
     * so we no longer need complex JS-side guards anymore.
     */
    const seek = useCallback((timeInSeconds: number) => {
        const clampedTime = Math.max(0, Math.min(state.duration || 0, timeInSeconds));

        // Update refs and shared value immediately for responsive UI (no React re-render)
        currentTimeRef.current = clampedTime;
        currentTimeShared.value = clampedTime;

        // Reset sync values to prevent jump back
        lastSyncPosition.value = clampedTime;
        lastSyncTimestamp.value = Date.now();

        // Debounced actual seek to VLC
        debouncedSeek(clampedTime);
    }, [state.duration, debouncedSeek, currentTimeShared, lastSyncPosition, lastSyncTimestamp]);

    /**
     * Perform immediate seek without debouncing.
     * Used for slider release, double-tap seeks, bookmark jumps.
     * 
     * SIMPLIFIED: No complex state guards - native VLC guard handles duplicates.
     */
    const seekImmediate = useCallback((timeInSeconds: number) => {
        const clampedTime = Math.max(0, Math.min(state.duration || 0, timeInSeconds));

        // Cancel any pending debounced seeks
        debouncedSeek.cancel();

        // Update refs and state
        currentTimeRef.current = clampedTime;
        currentTimeShared.value = clampedTime;

        // Reset sync values to prevent jump back
        lastSyncPosition.value = clampedTime;
        lastSyncTimestamp.value = Date.now();

        setState(prev => ({
            ...prev,
            currentTime: clampedTime,
        }));

        // Activating timing guard: ignore progress/seek updates for only 500ms (Reduced from 2000ms)
        // With timestamp validation (in handleProgress), we don't need a long timer anymore.
        scrubEndTimeRef.current = Date.now();
        lastAppliedSeekRef.current = clampedTime; // Track this for validation

        // Apply immediately to VLC
        applySeekToVLC(clampedTime);
    }, [state.duration, debouncedSeek, applySeekToVLC, currentTimeShared, lastSyncPosition, lastSyncTimestamp]);

    /**
     * Perform seek for scrubbing (NO STATE UPDATE).
     * Used during dragging to update native player without triggering re-renders.
     * UI updates are handled by SharedValues and Reanimated.
     */
    const seekScrubbing = useCallback((timeInSeconds: number) => {
        const clampedTime = Math.max(0, Math.min(state.duration || 0, timeInSeconds));

        // Update refs and shared value immediately
        currentTimeRef.current = clampedTime;
        currentTimeShared.value = clampedTime;

        // Reset sync values 
        lastSyncPosition.value = clampedTime;
        lastSyncTimestamp.value = Date.now();

        // NO SET STATE here - prevents re-renders during drag

        // Activating timing guard
        scrubEndTimeRef.current = Date.now();
        lastAppliedSeekRef.current = clampedTime;

        // Apply immediately to VLC
        applySeekToVLC(clampedTime);
    }, [state.duration, applySeekToVLC, currentTimeShared, lastSyncPosition, lastSyncTimestamp]);

    /**
     * Set seeking state - called by gesture handlers.
     * Used primarily for UI feedback, not blocking.
     */
    const setIsSeeking = useCallback((seeking: boolean) => {
        setState(prev => ({
            ...prev,
            isSeeking: seeking,
        }));
    }, []);

    // ========================================================================
    // PLAYBACK CONTROLS
    // ========================================================================

    const play = useCallback(() => {
        // We no longer call videoRef.current?.resume?() here.
        // Re-creating or resuming the player via native method while the 'paused' prop 
        // is also being toggled leads to race conditions and "simultaneous play/pause" glitches.
        // The VLCPlayer component will handle the play/pause transition itself via the 'paused' prop.

        // Optimistic update for UI smoothness
        isPlayingShared.value = true;

        setState(prev => {
            // REPLAY FIX: If we are restarting (stopped or at end), reset all sync refs
            // This prevents "Stale Event Guard" from blocking the 0.0s update
            if (prev.playerStopped || (prev.duration > 0 && Math.abs(currentTimeRef.current - prev.duration) < 1.0)) {
                lastAppliedSeekRef.current = 0;
                currentTimeRef.current = 0;
                currentTimeShared.value = 0;
                lastSyncPosition.value = 0;
                lastSyncTimestamp.value = Date.now();
                scrubEndTimeRef.current = Date.now(); // reset scrub timer
                if (__DEV__) console.log('[usePlayerCore] Replay detected - resetting sync refs');
            }

            return {
                ...prev,
                paused: false,
                isPlaying: true,
                playerStopped: false,
            };
        });

        if (__DEV__) console.log('[usePlayerCore] Play triggered (state updated)');
    }, [isPlayingShared]);

    const pause = useCallback(() => {

        // Optimistic update
        isPlayingShared.value = false;

        setState(prev => {
            return {
                ...prev,
                paused: true,
                isPlaying: false,
                isBuffering: false,
            };
        });
        onProgressSave?.();
        if (__DEV__) console.log('[usePlayerCore] Paused');
    }, [onProgressSave, isPlayingShared]);

    // Note: 'stop' is a reserved word in some contexts, but valid JS function name.
    const stop = useCallback(() => {
        videoRef.current?.stopPlayer?.();

        isPlayingShared.value = false;

        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true,
            seekFraction: null,
        }));
        if (__DEV__) console.log('[usePlayerCore] Stopped and resources released');
    }, [isPlayingShared]);

    const togglePlayPause = useCallback(() => {
        if (state.paused) {
            play();
        } else {
            pause();
        }
    }, [state.paused, play, pause]);

    // ========================================================================
    // VLC EVENT HANDLERS
    // ========================================================================

    /**
     * Handle VLC load event.
     * Called when video metadata is available.
     */
    const handleLoad = useCallback((data: VLCLoadData) => {
        const durationInSeconds = (data.duration ?? 0) / 1000;

        // Guard against junk duration values (0 or 1ms) during media re-init
        if (durationInSeconds <= 1) {
            if (__DEV__) console.log('[usePlayerCore] Load ignored - junk duration:', durationInSeconds);
            return;
        }

        setState(prev => ({
            ...prev,
            duration: durationInSeconds,
            isVideoLoaded: true,
            playerStopped: false,
            errorText: null,
        }));

        // Update shared value for gestures
        durationShared.value = durationInSeconds;

        // Notify about audio tracks if available
        if (data.audioTracks && data.audioTracks.length > 0 && onAudioTracksLoaded) {
            const tracks = data.audioTracks
                .filter(track => track.id !== -1)
                .map(track => ({
                    id: track.id,
                    name: track.name || `Audio Track ${track.id}`,
                }));
            onAudioTracksLoaded(tracks);
        }

        if (__DEV__) {
            if (__DEV__) console.log('[usePlayerCore] VLC Media loaded:', {
                duration: durationInSeconds,
                audioTracks: data.audioTracks?.length ?? 0,
            });
        }

        // Handle resume position - seek to last saved position
        if (
            resumePosRef.current &&
            resumePosRef.current > 0 &&
            durationInSeconds &&
            resumePosRef.current < durationInSeconds - 1
        ) {
            const resumeTime = resumePosRef.current;

            if (__DEV__) {
                if (__DEV__) console.log('[usePlayerCore] Resuming from:', resumeTime);
            }

            // Update all time tracking
            currentTimeRef.current = resumeTime;
            currentTimeShared.value = resumeTime;

            // Sync values
            lastSyncPosition.value = resumeTime;
            lastSyncTimestamp.value = Date.now();

            setState(prev => ({
                ...prev,
                currentTime: resumeTime,
            }));

            // Clear resume position so it's not applied again
            resumePosRef.current = null;

            // Block progress updates for a moment to prevent VLC from emitting 0 before seek applies
            scrubEndTimeRef.current = Date.now();

            // Apply the actual seek to VLC after a short delay to ensure player is ready
            setTimeout(() => {
                const fraction = resumeTime / durationInSeconds;
                lastAppliedSeekRef.current = fraction;
                videoRef.current?.seek(fraction);
                if (__DEV__) console.log('[usePlayerCore] Applied resume seek:', fraction);
            }, 100);
        }
    }, [onAudioTracksLoaded, durationShared, currentTimeShared, lastSyncPosition, lastSyncTimestamp]);

    /**
     * Handle VLC progress event.
     * Called frequently during playback with current position.
     * 
     * CRITICAL: This is the most frequently called handler.
     * Optimized to minimize state updates and re-renders.
     * 
     * SIMPLIFIED: Native VLC guard prevents re-seeks, so we no longer need
     * to block updates during seeking. Just throttle state updates for perf.
     */
    const handleProgress = useCallback((data: VLCProgressData) => {
        // Prevent updates if user is currently scrubbing to avoid fighting
        if (isScrubbingShared.value) return;

        const currentTimeInSeconds = (data.currentTime ?? 0) / 1000;
        const durationInSeconds = (data.duration ?? 0) / 1000;

        // Guard against stale events: Ignore progress if it's OLDER than our last sought time
        if (currentTimeInSeconds < lastAppliedSeekRef.current - 1.0) {
            return;
        }

        // Guard against junk duration values (0 or 1ms) during media re-init
        if (durationInSeconds <= 1) return;

        // MONOTONIC GUARD (Jitter Prevention):
        // If we are playing, and not seeking, the time should NEVER go backwards.
        // If Native reports a time BEHIND our smooth UI, it's likely lag/jitter. We ignore it.
        // Exception: If drift is huge (>1.5s), we assume it's a real seek/buffer event we missed.
        if (isPlayingShared.value && currentTimeInSeconds < currentTimeShared.value - 0.5) {
            // REPLAY FIX: If the new time is near zero (< 0.5s), it's likely a restart/replay.
            // We MUST allow this, even if it's a "backward" jump.
            if (currentTimeInSeconds < 0.5) {
                // Allow restart - do nothing (fall through to sync)
            } else {
                const backwardDrift = currentTimeShared.value - currentTimeInSeconds;
                if (backwardDrift < 1.5) {
                    return;
                }
            }
        }

        // Always update refs (source of truth for logic)
        currentTimeRef.current = currentTimeInSeconds;

        // SYNC for Smooth Interpolation
        // Calculate where we SHOULD be according to our own smooth prediction
        const now = Date.now();
        const elapsedSinceLastSync = (now - lastSyncTimestamp.value) / 1000;
        const expectedTime = lastSyncPosition.value + (elapsedSinceLastSync * playbackRateShared.value);
        const drift = Math.abs(currentTimeInSeconds - expectedTime);

        // JITTER FIX:
        // Native updates lag slightly behind our optimistic UI prediction.
        // If the native time is within 1.0s of our prediction, we IGNORE it for sync purposes.
        // This stops the slider from being pulled backward ("ghosting") every 250ms.
        // We only resync if real drift (buffering/lag) exceeds 1.0s.
        if (drift > 1.0 || !isPlayingShared.value) {
            // Huge drift or we thought we were paused - Force Sync
            if (__DEV__ && isPlayingShared.value) console.log('[usePlayerCore] Drift detected:', drift, 's. Resyncing to', currentTimeInSeconds);

            lastSyncPosition.value = currentTimeInSeconds;
            lastSyncTimestamp.value = now;

            // Snap shared value immediately if drift was huge
            if (drift > 2.0) {
                currentTimeShared.value = currentTimeInSeconds;
            }
        }
        // Else: We are within tolerance. Trust our smooth `useFrameCallback` loop. It's accurate enough.

        // Ensure playing state is synced
        if (!state.paused && !isPlayingShared.value) {
            isPlayingShared.value = true;
            // Also reset sync timestamp if we're waking up
            lastSyncTimestamp.value = now;
            lastSyncPosition.value = currentTimeInSeconds;
        }

        // Only update state at display intervals to minimize re-renders
        const shouldUpdateDisplay =
            now - lastDisplayUpdateRef.current > PLAYER_CONSTANTS.DISPLAY_TIME_UPDATE_INTERVAL;

        if (shouldUpdateDisplay) {
            lastDisplayUpdateRef.current = now;

            // Use functional state update to remove state dependencies
            setState(prev => {
                const durationChanged = Math.abs(durationInSeconds - prev.duration) > 1.0;

                if (Math.abs(currentTimeInSeconds - prev.currentTime) > 0.1 || durationChanged) {
                    return {
                        ...prev,
                        currentTime: currentTimeInSeconds,
                        duration: durationChanged ? durationInSeconds : prev.duration,
                    };
                }
                return prev;
            });
        }
    }, [currentTimeShared, isScrubbingShared, lastSyncPosition, lastSyncTimestamp, isPlayingShared, state.paused, playbackRateShared]);

    /**
     * Handle VLC end event.
     */
    const handleEnd = useCallback(() => {
        if (repeat) {
            // Replay from beginning
            videoRef.current?.seek(0);
            currentTimeRef.current = 0;
            currentTimeShared.value = 0;
            lastSyncPosition.value = 0;
            lastSyncTimestamp.value = Date.now();

            setState(prev => ({
                ...prev,
                currentTime: 0,
                seekFraction: 0,
                isPlaying: true, // Native handles restart, but UI needs this
            }));
            if (__DEV__) console.log('[usePlayerCore] Video ended - repeating');
            return;
        }

        if (sleepTimer === -1) {
            // Sleep timer set to "End of Video"
            if (__DEV__) console.log('[usePlayerCore] Sleep timer triggered at end');
            onSleepTimerEnd?.();
            // Don't return, let it fall through to 'Normal end' below
        }

        // Normal end - player is now stopped natively
        setState(prev => ({
            ...prev,
            paused: true,
            currentTime: prev.duration,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true, // Mark as stopped so play() knows we are starting fresh
        }));

        isPlayingShared.value = false;

        // CRITICAL FIX: Snap shared value to end for UI
        currentTimeShared.value = state.duration;
        currentTimeRef.current = state.duration;

        onProgressSave?.();
        if (__DEV__) console.log('[usePlayerCore] Video ended - progress saved');
    }, [repeat, sleepTimer, onSleepTimerEnd, onProgressSave, state.duration, currentTimeShared, lastSyncPosition, lastSyncTimestamp, isPlayingShared]);

    /**
     * Handle VLC error event.
     */
    const handleError = useCallback((e: any) => {
        const msg = e?.error || e?.message || 'Playback error';

        isPlayingShared.value = false;

        setState(prev => ({
            ...prev,
            errorText: String(msg),
            isBuffering: false,
            seekFraction: null,
        }));
        if (__DEV__) console.error('[usePlayerCore] VLC error:', e);
    }, [isPlayingShared]);

    /**
     * Handle VLC buffering event.
     * Debounced to prevent rapid state changes.
     */
    const handleBuffering = useCallback((event: VLCBufferingEvent | any) => {
        const bufferingState = typeof event === 'boolean'
            ? event
            : (event?.isBuffering ?? false);

        // Handle buffering event


        // Clear existing timeout
        if (bufferingTimeoutRef.current) {
            clearTimeout(bufferingTimeoutRef.current);
        }

        if (bufferingState) {
            setState(prev => ({ ...prev, isBuffering: true }));
        } else {
            // Debounce buffering-off to prevent flicker
            bufferingTimeoutRef.current = setTimeout(() => {
                setState(prev => ({ ...prev, isBuffering: false }));
            }, PLAYER_CONSTANTS.BUFFERING_TIMEOUT_MS);
        }
    }, [state.isVideoLoaded, state.isPlaying]);

    /**
     * Handle VLC playing event.
     */
    const handlePlaying = useCallback(() => {

        // Guard against rapid oscillation: ignore if we just processed a pause event
        const now = Date.now();
        const lastEvent = lastPlayPauseEventRef.current;
        if (lastEvent && lastEvent.type === 'pause' && (now - lastEvent.time) < PLAY_PAUSE_DEBOUNCE_MS) {
            return;
        }

        // Record this event
        lastPlayPauseEventRef.current = { type: 'play', time: now };

        isPlayingShared.value = true;

        // Reset sync to smooth out start
        lastSyncTimestamp.value = now;
        lastSyncPosition.value = currentTimeRef.current;

        setState(prev => {
            // Skip if already in desired state to prevent unnecessary re-renders
            if (!prev.paused && prev.isPlaying) {
                return prev;
            }
            return {
                ...prev,
                paused: false,
                isPlaying: true,
                isBuffering: false,
                playerStopped: false,
            };
        });
        if (__DEV__) console.log('[usePlayerCore] Playing started');
    }, [isPlayingShared, lastSyncTimestamp, lastSyncPosition]);

    /**
     * Handle VLC paused event.
     */
    const handlePaused = useCallback(() => {

        // Guard against rapid oscillation: ignore if we just processed a play event
        const now = Date.now();
        const lastEvent = lastPlayPauseEventRef.current;
        if (lastEvent && lastEvent.type === 'play' && (now - lastEvent.time) < PLAY_PAUSE_DEBOUNCE_MS) {
            return;
        }

        // Record this event
        lastPlayPauseEventRef.current = { type: 'pause', time: now };

        isPlayingShared.value = false;

        setState(prev => {
            // Skip if already in desired state to prevent unnecessary re-renders
            if (prev.paused && !prev.isPlaying) {
                return prev;
            }
            return {
                ...prev,
                paused: true,
                isPlaying: false,
            };
        });
        onProgressSave?.();
        if (__DEV__) console.log('[usePlayerCore] Video paused - progress saved');
    }, [onProgressSave, isPlayingShared]);

    /**
     * Handle VLC stopped event.
     */
    const handleStopped = useCallback(() => {
        isPlayingShared.value = false;

        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true,
            seekFraction: null,
        }));
        if (__DEV__) console.log('[usePlayerCore] Video stopped');
    }, [isPlayingShared]);

    /**
     * Handle VLC seek event (from native).
     * Called when native player positions changes (e.g. from notification).
     */
    const handleSeek = useCallback((data: VLCSeekEvent) => {
        // Guard against stale events during scrubbing/seeking (500ms window)
        if (Date.now() - scrubEndTimeRef.current < 500) return;

        const currentTimeInSeconds = (data.currentTime ?? 0) / 1000;
        const durationInSeconds = (data.duration ?? 0) / 1000;

        // Guard against stale seeks: Ignore if it's older than our last requested seek
        if (currentTimeInSeconds < lastAppliedSeekRef.current - 1.0) {
            return;
        }

        // Guard against junk duration values (0 or 1ms) during media re-init
        if (durationInSeconds <= 1) return;

        // Update refs
        currentTimeRef.current = currentTimeInSeconds;
        currentTimeShared.value = currentTimeInSeconds;

        // Update sync values
        lastSyncPosition.value = currentTimeInSeconds;
        lastSyncTimestamp.value = Date.now();

        // Update state
        setState(prev => ({
            ...prev,
            currentTime: currentTimeInSeconds,
            duration: durationInSeconds,
        }));

        // Force save progress immediately to ensure resume works if app is killed/restarted
        onProgressSave?.();

        if (__DEV__) console.log('[usePlayerCore] Native seek detected:', currentTimeInSeconds);
    }, [currentTimeShared, onProgressSave, lastSyncPosition, lastSyncTimestamp]);



    // ========================================================================
    // CLEANUP
    // ========================================================================

    useEffect(() => {
        return () => {
            // Clean up debounced seek
            debouncedSeek.cancel();

            // Clean up buffering timeout
            if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
            }
        };
    }, []);

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        // Refs
        videoRef,
        currentTimeRef,

        // State
        state,

        // Shared values for gestures
        currentTimeShared,
        durationShared,
        isScrubbingShared,

        // Actions
        play,
        pause,
        stop,
        togglePlayPause,
        seek,
        seekImmediate,
        seekScrubbing,

        // VLC event handlers
        handleLoad,
        handleProgress,
        handleEnd,
        handleError,
        handleBuffering,
        handlePlaying,
        handlePaused,
        handleStopped,
        handleSeek,

        // Display helpers
        displayTime,
        formattedTime,
        formattedDuration,
    }), [
        videoRef, currentTimeRef, state,
        currentTimeShared, durationShared, isScrubbingShared,
        play, pause, stop, togglePlayPause, seek, seekImmediate, seekScrubbing,
        handleLoad, handleProgress, handleEnd, handleError, handleBuffering, handlePlaying, handlePaused, handleStopped, handleSeek,
        displayTime, formattedTime, formattedDuration
    ]);
}

export default usePlayerCore;

export { initialPlayerState };
