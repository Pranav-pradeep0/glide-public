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
import { useSharedValue } from 'react-native-reanimated';
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

        // Debounced actual seek to VLC
        debouncedSeek(clampedTime);
    }, [state.duration, debouncedSeek, currentTimeShared]);

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
    }, [state.duration, debouncedSeek, applySeekToVLC, currentTimeShared]);

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

        // NO SET STATE here - prevents re-renders during drag

        // Activating timing guard
        scrubEndTimeRef.current = Date.now();
        lastAppliedSeekRef.current = clampedTime;

        // Apply immediately to VLC
        applySeekToVLC(clampedTime);
    }, [state.duration, applySeekToVLC, currentTimeShared]);

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

        console.log('[DEBUG RACE] usePlayerCore.play() called at:', Date.now());
        setState(prev => {
            console.log('[DEBUG RACE] play() setState: prev.paused=', prev.paused, 'prev.isPlaying=', prev.isPlaying);
            return {
                ...prev,
                paused: false,
                isPlaying: true,
                playerStopped: false,
            };
        });

        if (__DEV__) console.log('[usePlayerCore] Play triggered (state updated)');
    }, []);

    const pause = useCallback(() => {
        console.log('[DEBUG RACE] usePlayerCore.pause() called at:', Date.now());
        setState(prev => {
            console.log('[DEBUG RACE] pause() setState: prev.paused=', prev.paused, 'prev.isPlaying=', prev.isPlaying);
            return {
                ...prev,
                paused: true,
                isPlaying: false,
                isBuffering: false,
            };
        });
        onProgressSave?.();
        if (__DEV__) console.log('[usePlayerCore] Paused');
    }, [onProgressSave]);

    // Note: 'stop' is a reserved word in some contexts, but valid JS function name.
    const stop = useCallback(() => {
        videoRef.current?.stopPlayer?.();
        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true,
            seekFraction: null,
        }));
        if (__DEV__) console.log('[usePlayerCore] Stopped and resources released');
    }, []);

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
            console.log('[usePlayerCore] VLC Media loaded:', {
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
                console.log('[usePlayerCore] Resuming from:', resumeTime);
            }

            // Update all time tracking
            currentTimeRef.current = resumeTime;
            currentTimeShared.value = resumeTime;

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
    }, [onAudioTracksLoaded, durationShared, currentTimeShared]);

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
        // This replaces the 2000ms timer with a precise timestamp check
        if (currentTimeInSeconds < lastAppliedSeekRef.current - 1.0) {
            if (__DEV__) console.log('[usePlayerCore] Ignoring stale progress:', currentTimeInSeconds, 'Expected >', lastAppliedSeekRef.current);
            return;
        }

        // Guard against junk duration values (0 or 1ms) during media re-init
        if (durationInSeconds <= 1) return;

        // Always update refs (no re-render)
        currentTimeRef.current = currentTimeInSeconds;
        currentTimeShared.value = currentTimeInSeconds;

        // Only update state at display intervals to minimize re-renders
        const now = Date.now();
        const shouldUpdateDisplay =
            now - lastDisplayUpdateRef.current > PLAYER_CONSTANTS.DISPLAY_TIME_UPDATE_INTERVAL;

        if (shouldUpdateDisplay) {
            lastDisplayUpdateRef.current = now;

            // Use functional state update to remove state dependencies (prevents recreation)
            setState(prev => {
                // PIN-POINT FIX: Only update duration if it changes drastically (>1s) (Live Streams)
                // Otherwise ignore micro-jitter from VLC to prevent re-renders
                const durationChanged = Math.abs(durationInSeconds - prev.duration) > 1.0;

                // Only update if changed significantly to reduce re-renders
                if (Math.abs(currentTimeInSeconds - prev.currentTime) > 0.1 || durationChanged) {
                    return {
                        ...prev,
                        currentTime: currentTimeInSeconds,
                        // Only update duration if it really changed (prevents flicker)
                        duration: durationChanged ? durationInSeconds : prev.duration,
                    };
                }
                return prev;
            });
        }
    }, [currentTimeShared, isScrubbingShared]); // Removed state.currentTime dependency

    /**
     * Handle VLC end event.
     */
    const handleEnd = useCallback(() => {
        if (repeat) {
            // Replay from beginning
            videoRef.current?.seek(0);
            currentTimeRef.current = 0;
            currentTimeShared.value = 0;
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
        currentTimeRef.current = state.duration;
        onProgressSave?.();
        if (__DEV__) console.log('[usePlayerCore] Video ended - progress saved');
    }, [repeat, sleepTimer, onSleepTimerEnd, onProgressSave, state.duration, currentTimeShared]);

    /**
     * Handle VLC error event.
     */
    const handleError = useCallback((e: any) => {
        const msg = e?.error || e?.message || 'Playback error';
        setState(prev => ({
            ...prev,
            errorText: String(msg),
            isBuffering: false,
            seekFraction: null,
        }));
        if (__DEV__) console.error('[usePlayerCore] VLC error:', e);
    }, []);

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
        console.log('[DEBUG RACE] VLC onPlaying event at:', Date.now());

        // Guard against rapid oscillation: ignore if we just processed a pause event
        const now = Date.now();
        const lastEvent = lastPlayPauseEventRef.current;
        if (lastEvent && lastEvent.type === 'pause' && (now - lastEvent.time) < PLAY_PAUSE_DEBOUNCE_MS) {
            console.log('[DEBUG RACE] SKIPPING onPlaying - too soon after pause event:', now - lastEvent.time, 'ms');
            return;
        }

        // Record this event
        lastPlayPauseEventRef.current = { type: 'play', time: now };

        setState(prev => {
            // Skip if already in desired state to prevent unnecessary re-renders
            if (!prev.paused && prev.isPlaying) {
                console.log('[DEBUG RACE] handlePlaying SKIPPED - already playing');
                return prev;
            }
            console.log('[DEBUG RACE] handlePlaying setState: prev.paused=', prev.paused, 'prev.isPlaying=', prev.isPlaying);
            return {
                ...prev,
                paused: false,
                isPlaying: true,
                isBuffering: false,
                playerStopped: false,
            };
        });
        if (__DEV__) console.log('[usePlayerCore] Playing started');
    }, []);

    /**
     * Handle VLC paused event.
     */
    const handlePaused = useCallback(() => {
        console.log('[DEBUG RACE] VLC onPaused event at:', Date.now());

        // Guard against rapid oscillation: ignore if we just processed a play event
        const now = Date.now();
        const lastEvent = lastPlayPauseEventRef.current;
        if (lastEvent && lastEvent.type === 'play' && (now - lastEvent.time) < PLAY_PAUSE_DEBOUNCE_MS) {
            console.log('[DEBUG RACE] SKIPPING onPaused - too soon after play event:', now - lastEvent.time, 'ms');
            return;
        }

        // Record this event
        lastPlayPauseEventRef.current = { type: 'pause', time: now };

        setState(prev => {
            // Skip if already in desired state to prevent unnecessary re-renders
            if (prev.paused && !prev.isPlaying) {
                console.log('[DEBUG RACE] handlePaused SKIPPED - already paused');
                return prev;
            }
            console.log('[DEBUG RACE] handlePaused setState: prev.paused=', prev.paused, 'prev.isPlaying=', prev.isPlaying);
            return {
                ...prev,
                paused: true,
                isPlaying: false,
            };
        });
        onProgressSave?.();
        if (__DEV__) console.log('[usePlayerCore] Video paused - progress saved');
    }, [onProgressSave]);

    /**
     * Handle VLC stopped event.
     */
    const handleStopped = useCallback(() => {
        setState(prev => ({
            ...prev,
            paused: true,
            isPlaying: false,
            isBuffering: false,
            playerStopped: true,
            seekFraction: null,
        }));
        if (__DEV__) console.log('[usePlayerCore] Video stopped');
    }, []);

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

        // Update state
        setState(prev => ({
            ...prev,
            currentTime: currentTimeInSeconds,
            duration: durationInSeconds,
        }));

        // Force save progress immediately to ensure resume works if app is killed/restarted
        onProgressSave?.();

        if (__DEV__) console.log('[usePlayerCore] Native seek detected:', currentTimeInSeconds);
    }, [currentTimeShared, onProgressSave]);



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
    }, [debouncedSeek]);

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
