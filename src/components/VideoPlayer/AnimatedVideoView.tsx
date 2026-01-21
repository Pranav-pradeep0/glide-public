/**
 * AnimatedVideoView Component
 *
 * A memoized wrapper around VLCPlayer that handles zoom/pan animations.
 * This component is isolated to prevent unnecessary re-renders of the heavy VLCPlayer.
 */

import React, { memo, forwardRef, useMemo, useRef, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { AnimatedStyle } from 'react-native-reanimated';
import { VLCPlayer, PlayerResizeMode, VLCPlayerSource } from 'react-native-vlc-media-player';
import {
    VLCLoadData,
    VLCProgressData,
    VLCSeekEvent,
    VLCBufferingEvent,
    getOptimizedInitOptions,
} from '@/hooks/video-player/types';
import { usePipModeListener } from '@/native/PipModule';

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
    currentTime: number;
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
            currentTime,
            duration,
            audioTrack,
            textTrack,
            title,
            artist,
            audioEqualizer,
            audioDelay,
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

        const isInPipMode = usePipModeListener();

        // Resume Logic
        const pendingResumeRef = useRef<number | null>(null);

        // Calculate initial resume position only when playerKey changes (reload)
        useMemo(() => {
            if (currentTime > 0 && duration > 0) {
                const fraction = currentTime / duration;
                if (fraction > 0 && fraction < 0.99) {
                    console.log('[AnimatedVideoView] Setting pending resume fraction:', fraction);
                    pendingResumeRef.current = fraction;
                }
            } else {
                pendingResumeRef.current = null;
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [playerKey]); // Only re-calc on mount/key change

        // Intercept onPlaying to apply resume
        const handlePlaying = useCallback(() => {
            console.log('[DEBUG RACE] AnimatedVideoView.handlePlaying at:', Date.now(), 'pendingResume:', pendingResumeRef.current);
            // Apply pending resume if exists
            if (pendingResumeRef.current !== null) {
                const fraction = pendingResumeRef.current;
                console.log('[AnimatedVideoView] Applying manual resume seek:', fraction);

                // Use the forwarded ref if available
                if (ref && 'current' in ref && ref.current) {
                    ref.current.seek(fraction);
                }

                // Clear pending resume so we don't loop or re-seek
                pendingResumeRef.current = null;
            }

            // Forward event
            console.log('[DEBUG RACE] AnimatedVideoView forwarding onPlaying to parent');
            onPlaying();
        }, [onPlaying, ref]);

        // Build source with init options and media options for gapless looping
        const vlcSource = {
            ...source,
            initType: 2 as 1 | 2,
            initOptions: getOptimizedInitOptions(source.uri, decoder, videoEnhancement),
            mediaOptions: repeat ? [':input-repeat=65535'] : [],
        };

        if (playerKey > 0) {
            console.log('[AnimatedVideoView] Init Options:', vlcSource.initOptions);
        }

        return (
            <Animated.View style={[styles.container, animatedStyle]}>
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
                    autoplay={true}
                    muted={muted}
                    resizeMode={resizeMode}
                    repeat={repeat}
                    title={title}
                    artist={artist}
                    audioEqualizer={audioEqualizer}
                    audioDelay={audioDelay}
                    onLoad={onLoad}
                    onProgress={onProgress}
                    onEnd={onEnd}
                    onError={onError}
                    onBuffering={onBuffering}
                    onPlaying={handlePlaying}
                    onPaused={onPaused}
                    onStopped={onStopped}
                    onSeek={onSeek}
                    playInBackground={playInBackground || isInPipMode}
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
    if (prevProps.playerKey !== nextProps.playerKey) return false;
    if (prevProps.source.uri !== nextProps.source.uri) return false;
    if (prevProps.paused !== nextProps.paused) return false;
    if (prevProps.rate !== nextProps.rate) return false;
    if (prevProps.muted !== nextProps.muted) return false;
    if (prevProps.repeat !== nextProps.repeat) return false;
    if (prevProps.resizeMode !== nextProps.resizeMode) return false;
    if (prevProps.decoder !== nextProps.decoder) return false;
    if (prevProps.videoEnhancement !== nextProps.videoEnhancement) return false;
    if (prevProps.audioTrack !== nextProps.audioTrack) return false;
    if (prevProps.textTrack !== nextProps.textTrack) return false;
    if (prevProps.title !== nextProps.title) return false;
    if (prevProps.artist !== nextProps.artist) return false;
    if (prevProps.audioEqualizer !== nextProps.audioEqualizer) return false;
    if (prevProps.audioDelay !== nextProps.audioDelay) return false;
    if (prevProps.playInBackground !== nextProps.playInBackground) return false;
    if (prevProps.onEnd !== nextProps.onEnd) return false; // Important: Check for onEnd handler updates (auto-play closure)

    // Ignore currentTime and duration changes!
    // These update frequently but shouldn't trigger re-render unless playerKey also changes.

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
    video: {
        flex: 1,
        width: '100%',
        height: '100%',
    },
});
