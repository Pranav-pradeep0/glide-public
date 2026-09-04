/**
 * AnimatedVideoView Component
 *
 * A memoized wrapper around VLCPlayer that handles zoom/pan animations.
 * This component is isolated to prevent unnecessary re-renders of the heavy VLCPlayer.
 */

import React, { memo, forwardRef, useMemo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { AnimatedStyle } from 'react-native-reanimated';
import { VLCPlayer, PlayerResizeMode, VLCPlayerSource } from '@glide/vlc-player';
import {
    VLCLoadData,
    VLCProgressData,
    VLCSeekEvent,
    VLCBufferingEvent,
    getOptimizedInitOptions,
} from '@/hooks/video-player/types';

// ============================================================================
// TYPES
// ============================================================================


interface AnimatedVideoViewProps {
    // Source
    source: VLCPlayerSource;
    playerKey: number;
    decoder: 'hardware' | 'software' | 'hardware_plus';
    videoEnhancement: boolean; // Prop to enable/disable enhancement

    // Playback state
    paused: boolean;
    rate: number;
    muted: boolean;
    repeat: boolean;
    resizeMode: PlayerResizeMode;
    playInBackground: boolean;
    pipEnabled: boolean;
    pipPresentationActive: boolean;
    /** Sampled only when playerKey changes, to resume after a decoder/enhancement remount. */
    currentTimeRef: React.MutableRefObject<number>;
    duration: number;

    // Tracks
    audioTrack?: number;
    textTrack?: number;

    // Metadata
    title?: string;
    artist?: string;

    // Audio
    audioEqualizer?: number[];
    audioDelay?: number;

    /**
     * Where to begin playback on the first mount, in seconds, from watch history.
     * Only the initial resume: a remount's position is captured natively.
     */
    initialResumeSeconds?: number;

    // Animation style from gestures
    animatedStyle: AnimatedStyle<any>;

    // VLC callbacks
    onLoad: (data: VLCLoadData) => void;
    onProgress: (data: VLCProgressData) => void;
    onEnd: () => void;
    onError: (e: any) => void;
    onBuffering: (event: VLCBufferingEvent | any) => void;
    onPlaying: () => void;
    onPaused: () => void;
    onStopped: () => void;
    onSeek: (data: VLCSeekEvent) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Memoized VLC player wrapper with animated container.
 *
 * Uses forwardRef to expose the VLCPlayer ref to parent.
 * Memoized to prevent re-renders when parent state changes.
 */
const AnimatedVideoView = forwardRef<VLCPlayer, AnimatedVideoViewProps>(
    function AnimatedVideoView(props, ref) {
        const {
            source,
            playerKey,
            decoder,
            videoEnhancement,
            paused,
            rate,
            muted,
            repeat,
            resizeMode,
            playInBackground,
            pipEnabled,
            pipPresentationActive,
            currentTimeRef,
            duration,
            audioTrack,
            textTrack,
            title,
            artist,
            audioEqualizer,
            audioDelay,
            initialResumeSeconds,
            animatedStyle,
            onLoad,
            onProgress,
            onEnd,
            onError,
            onBuffering,
            onPlaying,
            onPaused,
            onStopped,
            onSeek,
        } = props;

        /**
         * Where the native player should open, in seconds.
         *
         * A remount resumes from the live position; the first mount resumes from watch
         * history. Both cases build a *new* native view, so JavaScript has to carry the
         * offset across — a position saved inside the outgoing view would be lost with it.
         * Same-view recreates (an enhancement toggle, reviving a stopped player) are
         * handled natively and do not come through here.
         *
         * This is the whole resume mechanism now. It travels inside the source so it
         * cannot race the source prop, and native turns it into VLC's :start-time when the
         * demuxer is opened. Nothing seeks: LibVLC drops a setTime issued during its
         * startup ramp, which is why the previous 100 ms-after-onLoad seek landed at 0.
         */
        const startTimeSeconds = useMemo(() => {
            const END_GUARD_SECONDS = 0.2;

            if (playerKey > 0 && duration > 1) {
                // Read the live position here rather than taking it as a prop: the screen
                // no longer re-renders on progress, so a prop value would be stale.
                const maxSeek = Math.max(0, duration - END_GUARD_SECONDS);
                const clamped = Math.max(0, Math.min(maxSeek, currentTimeRef.current));
                // Deliberately no minimum: a remount near the start must still resume
                // where it was, not jump to zero.
                return clamped > 0 && clamped < maxSeek ? clamped : 0;
            }

            return initialResumeSeconds && initialResumeSeconds > 0 ? initialResumeSeconds : 0;
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [playerKey]); // Re-calc only when the player is rebuilt

        // Simple onPlaying handler - no more manual seeking needed!
        const handlePlaying = useCallback(() => {
            onPlaying();
        }, [onPlaying]);

        const vlcSource = useMemo(() => {
            const mediaOpts = repeat ? [':input-repeat=65535'] : [];

            return {
                ...source,
                initType: 2 as 1 | 2,
                initOptions: getOptimizedInitOptions(source.uri, decoder),
                decoderMode: decoder,
                mediaOptions: mediaOpts,
                // Seconds. Native opens the demuxer here, so resume needs no seek.
                startTime: startTimeSeconds > 0 ? startTimeSeconds : undefined,
            };
        }, [source, decoder, repeat, startTimeSeconds]);

        if (playerKey > 0) {
            if (__DEV__) {console.log('[AnimatedVideoView] Init Options:', vlcSource.initOptions);}
        }

        return (
            <Animated.View style={[
                styles.container,
                pipPresentationActive ? styles.pipContainer : animatedStyle,
            ]}>
                <VLCPlayer
                    key={playerKey}
                    ref={ref}
                    source={vlcSource}
                    paused={paused}
                    rate={rate}
                    seek={-1}
                    style={styles.video}
                    audioTrack={audioTrack}
                    textTrack={textTrack ?? -1}
                    autoplay={!paused}
                    muted={muted}
                    resizeMode={resizeMode}
                    repeat={repeat}
                    title={title}
                    artist={artist}
                    audioEqualizer={audioEqualizer}
                    audioDelay={audioDelay}
                    videoEnhancement={videoEnhancement}
                    onLoad={onLoad}
                    onProgress={onProgress}
                    onEnd={onEnd}
                    onError={onError}
                    onBuffering={onBuffering}
                    onPlaying={handlePlaying}
                    onPaused={onPaused}
                    onStopped={onStopped}
                    onSeek={onSeek}
                    playInBackground={playInBackground}
                    pipEnabled={pipEnabled}
                />
            </Animated.View>
        );
    }
);

// ============================================================================
// MEMOIZATION
// ============================================================================

/**
 * Custom comparison function for memo.
 * Only re-render when VLC-relevant props change.
 */
function areEqual(prevProps: AnimatedVideoViewProps, nextProps: AnimatedVideoViewProps): boolean {
    // Always re-render if these change (they directly affect VLC)
    if (prevProps.playerKey !== nextProps.playerKey) {return false;}
    if (prevProps.source.uri !== nextProps.source.uri) {return false;}
    if (prevProps.paused !== nextProps.paused) {return false;}
    if (prevProps.rate !== nextProps.rate) {return false;}
    if (prevProps.muted !== nextProps.muted) {return false;}
    if (prevProps.repeat !== nextProps.repeat) {return false;}
    if (prevProps.resizeMode !== nextProps.resizeMode) {return false;}
    if (prevProps.decoder !== nextProps.decoder) {return false;}
    if (prevProps.videoEnhancement !== nextProps.videoEnhancement) {return false;}
    if (prevProps.pipEnabled !== nextProps.pipEnabled) {return false;}
    if (prevProps.pipPresentationActive !== nextProps.pipPresentationActive) {return false;}
    if (prevProps.audioTrack !== nextProps.audioTrack) {return false;}
    if (prevProps.textTrack !== nextProps.textTrack) {return false;}
    if (prevProps.title !== nextProps.title) {return false;}
    if (prevProps.artist !== nextProps.artist) {return false;}
    if (prevProps.audioEqualizer !== nextProps.audioEqualizer) {return false;}
    if (prevProps.audioDelay !== nextProps.audioDelay) {return false;}
    if (prevProps.playInBackground !== nextProps.playInBackground) {return false;}
    if (prevProps.onEnd !== nextProps.onEnd) {return false;} // Important: Check for onEnd handler updates (auto-play closure)

    // Ignore duration changes: they must not trigger a re-render unless playerKey also
    // changes. Position is not a prop at all — it is read from the ref on remount.

    // animatedStyle is handled by reanimated
    // Callback references should be stable via useCallback

    return true;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default memo(AnimatedVideoView, areEqual);

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    pipContainer: {
        transform: [],
    },
    video: {
        flex: 1,
        width: '100%',
        height: '100%',
    },
});



