/**
 * usePlayerTracks Hook
 * 
 * Manages audio and subtitle track selection, subtitle cue parsing,
 * and external subtitle handling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SubtitleParser } from '@/utils/SubtitleParser';
import { SubtitleExtractor, SubtitleTrack } from '@/utils/SubtitleExtractor';
import { SubtitleCue } from '@/types';
import {
    NativeAudioTrack,
    ExternalSubtitle,
    UsePlayerTracksReturn,
} from './types';
import { findMatchingAudioTrack } from '@/utils/languages';
import { SubtitleCueStore } from '@/services/SubtitleCueStore';

// ============================================================================
// TYPES
// ============================================================================

interface UsePlayerTracksOptions {
    videoPath: string;
    currentTimeRef: React.MutableRefObject<number>;

    routeHapticCues?: SubtitleCue[];
    initialAudioTrackId?: number;
    initialSubtitleTrackIndex?: number;

    subtitleDelay?: number; // in milliseconds
    defaultAudioLanguage?: string | null;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing audio and subtitle tracks.
 * 
 * Features:
 * - Audio track loading from VLC
 * - Embedded subtitle track extraction via FFmpeg
 * - External subtitle file loading
 * - API subtitle support
 * - Current cue tracking for display
 * - SDH cues for haptic feedback
 */
export function usePlayerTracks(options: UsePlayerTracksOptions): UsePlayerTracksReturn {
    const { videoPath, currentTimeRef, routeHapticCues, initialAudioTrackId, initialSubtitleTrackIndex, subtitleDelay = 0, defaultAudioLanguage } = options;

    // ========================================================================
    // STATE
    // ========================================================================

    // Audio
    const [audioTracks, setAudioTracks] = useState<NativeAudioTrack[]>([]);
    const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<number | undefined>(initialAudioTrackId);

    // Sync initial audio track when it becomes available (hydration)
    useEffect(() => {
        if (initialAudioTrackId !== undefined && selectedAudioTrackId === undefined) {
            setSelectedAudioTrackId(initialAudioTrackId);
        }
    }, [initialAudioTrackId]);

    // Subtitles
    const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
    const [selectedSubtitleTrackIndex, setSelectedSubtitleTrackIndex] = useState<number | null>(initialSubtitleTrackIndex ?? null);

    // Sync initial subtitle track when it becomes available (hydration)
    useEffect(() => {
        if (initialSubtitleTrackIndex !== undefined && selectedSubtitleTrackIndex === null) {
            setSelectedSubtitleTrackIndex(initialSubtitleTrackIndex);
        }
    }, [initialSubtitleTrackIndex]);

    // VLC Native Text Track ID (for bitmap subtitles like PGS/VobSub)
    // -1 = disabled (or using custom overlay), >= 0 = enabled native track
    const [vlcTextTrackId, setVlcTextTrackId] = useState<number>(-1);

    const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
    const [currentSubtitleCue, setCurrentSubtitleCue] = useState<SubtitleCue | null>(null);

    // External subtitles
    const [externalSubtitles, setExternalSubtitles] = useState<ExternalSubtitle[]>([]);
    const [currentExternalName, setCurrentExternalName] = useState<string | null>(null);

    // Haptic cues
    const [hapticCues, setHapticCues] = useState<SubtitleCue[]>(routeHapticCues || []);

    // Refs
    const extractedSubtitlePathRef = useRef<string | null>(null);

    // ========================================================================
    // AUDIO TRACK HANDLING
    // ========================================================================

    /**
     * Set audio tracks from VLC onLoad event.
     * Called by parent component when VLC reports available tracks.
     */
    const setAudioTracksFromVLC = useCallback((tracks: NativeAudioTrack[]) => {
        setAudioTracks(tracks);
        // Select first track by default if not already selected AND no initial selection was provided
        // (If initialAudioTrackId was provided, selectedAudioTrackId is already set to it)
        if (selectedAudioTrackId === undefined && tracks.length > 0) {
            // Check for preferred language using smart matching
            if (defaultAudioLanguage) {
                const matchedTrackId = findMatchingAudioTrack(tracks, defaultAudioLanguage);
                if (matchedTrackId !== undefined) {
                    if (__DEV__) console.log('[usePlayerTracks] Auto-selecting audio track:', matchedTrackId, 'for preference:', defaultAudioLanguage);
                    setSelectedAudioTrackId(matchedTrackId);
                    return;
                }
            }

            // Fallback to first track
            setSelectedAudioTrackId(tracks[0].id);
        }
    }, [selectedAudioTrackId, defaultAudioLanguage]);

    const selectAudioTrack = useCallback((trackId: number | null) => {
        setSelectedAudioTrackId(trackId === null ? undefined : trackId);
        if (__DEV__) {
            console.log('[usePlayerTracks] Audio track selected:', trackId);
        }
    }, []);

    // ========================================================================
    // EMBEDDED SUBTITLE HANDLING
    // ========================================================================

    // Load embedded subtitle tracks on mount
    useEffect(() => {
        let mounted = true;

        const loadSubtitleTracks = async () => {
            try {
                const tracks = await SubtitleCueStore.getTracks(videoPath);
                if (mounted && tracks.length > 0) {
                    setSubtitleTracks(tracks);
                    if (__DEV__) {
                        console.log('[usePlayerTracks] Extracted subtitle tracks:', tracks.length);
                    }
                }
            } catch (error) {
                if (__DEV__) {
                    console.error('[usePlayerTracks] Failed to load subtitle tracks:', error);
                }
            }
        };

        loadSubtitleTracks();

        return () => {
            mounted = false;
        };
    }, [videoPath]);

    // Extract and parse selected subtitle track
    useEffect(() => {
        let mounted = true;

        const extractSubtitle = async () => {
            // No subtitle selected
            if (selectedSubtitleTrackIndex === null) {
                setSubtitleCues([]);
                setCurrentSubtitleCue(null);
                setVlcTextTrackId(-1); // Disable native
                return;
            }

            // External subtitle (special index -999)
            if (selectedSubtitleTrackIndex === -999) {
                // Cues already set by loadExternalCues
                setVlcTextTrackId(-1); // Disable native for external (we render them)
                return;
            }

            // Check if it's a bitmap subtitle (PGS, VobSub, etc.)
            const selectedTrack = subtitleTracks.find(t => t.index === selectedSubtitleTrackIndex);
            if (selectedTrack && selectedTrack.isBitmap) {
                if (__DEV__) {
                    console.log(`[usePlayerTracks] Bitmap subtitle detected (${selectedTrack.codec}), using VLC native rendering`);
                }
                setSubtitleCues([]); // Clear overlay
                setCurrentSubtitleCue(null);
                setVlcTextTrackId(selectedTrack.index); // Enable native
                return;
            }

            // It's a text subtitle, disable native and extract
            setVlcTextTrackId(-1);

            try {
                const cues = await SubtitleCueStore.getCues(videoPath, selectedSubtitleTrackIndex);
                if (!mounted) return;

                if (cues && cues.length > 0) {
                    setSubtitleCues(cues);
                    if (__DEV__) {
                        console.log(`[usePlayerTracks] Subtitle loaded: ${cues.length} cues`);
                    }
                } else if (mounted) {
                    setSubtitleCues([]);
                    setCurrentSubtitleCue(null);
                }
            } catch (error) {
                if (__DEV__) {
                    console.error('[usePlayerTracks] Failed to load cues from store:', error);
                }
                if (mounted) {
                    setSubtitleCues([]);
                    setCurrentSubtitleCue(null);
                }
            }
        };

        extractSubtitle();

        return () => {
            mounted = false;
        };
    }, [selectedSubtitleTrackIndex, videoPath, subtitleTracks]);

    // Track current subtitle cue based on playback time
    useEffect(() => {
        if (subtitleCues.length === 0) {
            setCurrentSubtitleCue(null);
            return;
        }

        const interval = setInterval(() => {
            // Apply subtitle delay offset (convert ms to seconds)
            const effectiveTime = currentTimeRef.current - (subtitleDelay / 1000);

            const cue = SubtitleParser.findActiveCue(subtitleCues, effectiveTime);
            setCurrentSubtitleCue(prevCue => {
                // Only update if cue actually changed
                if (prevCue?.text === cue?.text && prevCue?.startTime === cue?.startTime) {
                    return prevCue;
                }
                return cue;
            });
        }, 250); // 4x/sec is sufficient for subtitle display, saves battery

        return () => clearInterval(interval);
    }, [subtitleCues, currentTimeRef, subtitleDelay]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            SubtitleCueStore.evict(videoPath);
        };
    }, [videoPath]);

    const selectSubtitleTrack = useCallback((trackIndex: number | null) => {
        setSelectedSubtitleTrackIndex(trackIndex);
        // Clear external name if selecting embedded track
        if (trackIndex !== -999) {
            setCurrentExternalName(null);
        }
        if (__DEV__) {
            console.log('[usePlayerTracks] Subtitle track selected:', trackIndex);
        }
    }, []);

    // ========================================================================
    // EXTERNAL SUBTITLE HANDLING
    // ========================================================================

    /**
     * Load external subtitle cues (from file picker or API download).
     */
    const loadExternalCues = useCallback((cues: SubtitleCue[], name: string, isSDH: boolean) => {
        if (!cues || cues.length === 0) return;

        // Set as current display subtitle
        setSubtitleCues(cues);
        setSelectedSubtitleTrackIndex(-999); // Special index for external
        setCurrentExternalName(name);

        // Add to external subtitles list if not already there
        setExternalSubtitles(prev => {
            const exists = prev.some(s => s.name === name);
            if (exists) return prev;
            return [...prev, { name, cues, isSDH, source: 'file' }];
        });

        if (__DEV__) {
            console.log('[usePlayerTracks] Loaded external subtitle:', name, cues.length, 'cues', isSDH ? '(SDH)' : '');
        }
    }, []);

    /**
     * Load SDH subtitle cues specifically for haptic feedback.
     */
    const loadSDHForHaptics = useCallback((cues: SubtitleCue[], name: string) => {
        setHapticCues(cues);
        if (__DEV__) {
            console.log('[usePlayerTracks] Updated haptic cues from SDH:', name, cues.length, 'cues');
        }
    }, []);

    // ========================================================================
    // SELECTORS FOR COMPONENT PROPS
    // ========================================================================

    const audioTracksForSelector = useMemo(() =>
        audioTracks.map((track) => ({
            index: track.id,
            type: 'audio' as const,
            codec: 'audio',
            language: track.name,
            title: track.name,
            isDefault: false,
        })),
        [audioTracks]
    );

    const subtitleTracksForSelector = useMemo(() =>
        subtitleTracks.map((track) => ({
            index: track.index,
            type: 'subtitle' as const,
            codec: track.codec,
            language: track.language || 'und',
            title: track.title || `Subtitle ${track.index}`,
            isDefault: track.isDefault || false,
        })),
        [subtitleTracks]
    );

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        // Audio
        audioTracks,
        selectedAudioTrackId,
        selectAudioTrack,

        // Subtitles
        subtitleTracks,
        selectedSubtitleTrackIndex,
        subtitleCues,
        currentSubtitleCue,
        selectSubtitleTrack,
        vlcTextTrackId, // Expose for player to use

        // External
        externalSubtitles,
        currentExternalName,
        loadExternalCues,
        loadSDHForHaptics,

        // Haptic
        hapticCues,

        // Selectors
        audioTracksForSelector,
        subtitleTracksForSelector,

        // For parent to set audio tracks from VLC
        setAudioTracksFromVLC,
        // For drift correction updates
        setSubtitleCues,
    }), [
        audioTracks, selectedAudioTrackId, selectAudioTrack,
        subtitleTracks, selectedSubtitleTrackIndex, subtitleCues, currentSubtitleCue, selectSubtitleTrack,
        externalSubtitles, currentExternalName, loadExternalCues, loadSDHForHaptics,
        hapticCues,
        audioTracksForSelector, subtitleTracksForSelector,
        setAudioTracksFromVLC
    ]) as UsePlayerTracksReturn & {
        setAudioTracksFromVLC: typeof setAudioTracksFromVLC,
        setSubtitleCues: typeof setSubtitleCues
    };
}

export default usePlayerTracks;
