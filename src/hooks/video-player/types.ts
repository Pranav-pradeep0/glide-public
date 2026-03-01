/**
 * Video Player Hook Types
 * Shared types for all video player hooks
 */

import { VLCPlayer, PlayerResizeMode } from '@glide/vlc-player';
import { SharedValue } from 'react-native-reanimated';
import { SubtitleCue, VideoBookmark } from '@/types';

// ============================================================================
// CONSTANTS
// ============================================================================

export const PLAYER_CONSTANTS = {
    BUFFER_EPS: 0.25,
    HUD_HIDE_MS: 800,
    RIPPLE_DURATION_MS: 600,
    SPEED_HUD_HIDE_MS: 1500,
    CONTROLS_AUTO_HIDE_MS: 3000,
    BUFFERING_TIMEOUT_MS: 300,
    PROGRESS_SAVE_INTERVAL_MS: 2000,
    BOOKMARK_TOAST_DURATION_MS: 3000,
    DISPLAY_TIME_UPDATE_INTERVAL: 250,
    RESUME_DELAY_MS: 100,
    // Gesture thresholds
    SEEK_SENSITIVITY: 0.10,
    BRIGHTNESS_SENSITIVITY: 0.008, // Increased from 0.004
    VOLUME_SENSITIVITY: 0.008,     // Increased from 0.004
    SPEED_SENSITIVITY: 0.010,
    ZOOM_MIN: 1,
    ZOOM_MAX: 3,
    DOUBLE_TAP_SEEK_SECONDS: 10,
} as const;

// ============================================================================
// VLC EVENT DATA TYPES
// ============================================================================

export interface VLCLoadData {
    duration: number;
    videoSize?: { height: number; width: number };
    audioTracks?: Array<{ id: number; name: string }>;
    textTracks?: Array<{ id: number; name: string }>;
}

export interface VLCProgressData {
    currentTime: number;
    duration: number;
    position: number;
    remainingTime?: number;
}

export interface VLCPlayingData {
    target: number;
    duration: number;
    seekable: boolean;
}

export interface VLCBufferingEvent {
    isBuffering?: boolean;
}

export interface VLCSeekEvent {
    currentTime: number;
    duration: number;
    position: number;
}

// ============================================================================
// TRACK TYPES
// ============================================================================

export interface NativeAudioTrack {
    id: number;
    name: string;
}

export interface SubtitleTrack {
    index: number;
    codec: string;
    language?: string;
    title?: string;
    isDefault?: boolean;
}

export interface ExternalSubtitle {
    name: string;
    cues: SubtitleCue[];
    isSDH: boolean;
    source: 'file' | 'api';
}

// ============================================================================
// HUD STATE TYPES
// ============================================================================

export interface SeekHUDState {
    show: boolean;
    time: number;
    startTime: number;  // Time when seek started (for difference calculation)
    direction: 'forward' | 'backward' | null;
    side: 'left' | 'right' | null;  // For double-tap opposite-side positioning
}

export interface BrightnessHUDState {
    show: boolean;
    value: number;
}

export interface VolumeHUDState {
    show: boolean;
    value: number;
}

export interface SpeedHUDState {
    show: boolean;
    rate: number;
}

export interface ZoomHUDState {
    scale: number;
}

export interface ResizeModeHUDState {
    show: boolean;
    mode: string;
}

export interface RippleHUDState {
    show: boolean;
    x: number;
    y: number;
    side: 'left' | 'right';
}

export interface HUDState {
    seek: SeekHUDState;
    brightness: BrightnessHUDState;
    volume: VolumeHUDState;
    speed: SpeedHUDState;
    resize: ResizeModeHUDState;
    zoom: ZoomHUDState;
    ripple: RippleHUDState;
}

export type HUDType = keyof HUDState;

// HUD Action types for useReducer
export type HUDAction =
    | { type: 'SHOW_SEEK'; time: number; startTime: number; direction: 'forward' | 'backward' | null; side: 'left' | 'right' | null }
    | { type: 'HIDE_SEEK' }
    | { type: 'SHOW_BRIGHTNESS'; value: number }
    | { type: 'HIDE_BRIGHTNESS' }
    | { type: 'SHOW_VOLUME'; value: number }
    | { type: 'HIDE_VOLUME' }
    | { type: 'SHOW_SPEED'; rate: number }
    | { type: 'HIDE_SPEED' }
    | { type: 'SHOW_RESIZE'; mode: string }
    | { type: 'HIDE_RESIZE' }
    | { type: 'UPDATE_ZOOM'; scale: number }
    | { type: 'SHOW_RIPPLE'; x: number; y: number; side: 'left' | 'right' }
    | { type: 'HIDE_RIPPLE' }
    | { type: 'RESET_ALL' }
    | { type: 'RESET_SPEED' };

// ============================================================================
// UI STATE TYPES
// ============================================================================

/** Panel types that can be opened (only one at a time) */
export type PanelType =
    | 'quickSettings'
    | 'bookmarkPanel'
    | 'playlist'
    | 'audioSelector'
    | 'subtitleSelector';

export interface UIState {
    controlsVisible: boolean;
    locked: boolean;
    lockIconVisible: boolean;
    // Panel states - only one should be true at a time
    quickSettingsOpen: boolean;
    bookmarkPanelOpen: boolean;
    playlistOpen: boolean;
    audioSelectorOpen: boolean;
    subtitleSelectorOpen: boolean;
}

// ============================================================================
// PLAYER CORE STATE TYPES
// ============================================================================

export interface PlayerState {
    paused: boolean;
    duration: number;
    currentTime: number;
    isVideoLoaded: boolean;
    isPlaying: boolean;
    isBuffering: boolean;
    isSeeking: boolean;
    playerStopped: boolean;
    errorText: string | null;
}

export interface PlayerSettings {
    muted: boolean;
    repeat: boolean;
    sleepTimer: number | null; // null = off, -1 = end of video, number = minutes
    decoder: 'hardware' | 'software' | 'hardware_plus';
    resizeMode: PlayerResizeMode;
    playerKey: number; // Used to force remount on decoder change
    skipDuration: 5 | 10 | 30; // seconds for skip forward/backward
    backgroundPlayEnabled: boolean; // Continue audio when app is backgrounded
    videoEnhancement: boolean;

    // Equalizer
    equalizerEnabled: boolean;
    equalizerPreset: string;
    customEqualizerBands: number[]; // 10 bands

    // Synchronization
    audioDelay: number;
    subtitleDelay: number;

    // Subtitle Appearance
    subtitleFontSize: number;
    subtitleColor: string;
    subtitleFontWeight: number; // 400-900
    subtitleOutlineWidth: number; // 0-6
    subtitleBackgroundColor: string;
    subtitleBackgroundOpacity: number;
    subtitleEdgeStyle: 'none' | 'outline' | 'dropShadow';
}

// ============================================================================
// HOOK RETURN TYPES
// ============================================================================

export interface UsePlayerCoreReturn {
    // Refs - allowing null for useRef initialization
    videoRef: React.RefObject<VLCPlayer | null>;
    currentTimeRef: React.MutableRefObject<number>;

    // State
    state: PlayerState;

    // Shared values for gestures
    currentTimeShared: SharedValue<number>;
    durationShared: SharedValue<number>;
    isScrubbingShared: SharedValue<boolean>;

    // Actions
    play: () => void;
    pause: () => void;
    stop: () => void;
    togglePlayPause: () => void;
    previewSeek: (timeInSeconds: number) => void;
    commitSeek: (timeInSeconds: number) => void;
    setIsSeeking: (seeking: boolean) => void;
    clearResumePosition: () => void;

    // VLC event handlers
    handleLoad: (data: VLCLoadData) => void;
    handleProgress: (data: VLCProgressData) => void;
    handleEnd: () => void;
    handleError: (e: any) => void;
    handleBuffering: (event: VLCBufferingEvent | any) => void;
    handlePlaying: () => void;
    handlePaused: () => void;
    handleStopped: () => void;
    handleSeek: (data: VLCSeekEvent) => void;



    // Display helpers
    displayTime: number;
    formattedTime: string;
    formattedDuration: string;
}

export interface UsePlayerUIReturn {
    state: UIState;
    isLockedShared: SharedValue<boolean>;

    // Actions
    toggleControls: () => void;
    showControls: () => void;
    hideControls: () => void;
    scheduleAutoHide: () => void;
    cancelAutoHide: () => void;
    lock: () => void;
    unlock: () => void;
    toggleLock: () => void;
    showLockIconTemporarily: () => void;

    // Panel actions
    openPanel: (panel: PanelType) => void;
    closePanel: (panel: PanelType) => void;
    closeAllPanels: () => void;
}

export interface UsePlayerHUDReturn {
    state: HUDState;

    // Actions
    showSeekHUD: (time: number, direction?: 'forward' | 'backward' | null, side?: 'left' | 'right' | null, isGestureActive?: boolean) => void;
    hideSeekHUD: () => void;
    setSeekStartTime: (time: number, forceNewStart?: boolean) => void;
    showBrightnessHUD: (value: number, isGestureActive?: boolean) => void;
    hideBrightnessHUD: () => void;
    showVolumeHUD: (value: number, isGestureActive?: boolean) => void;
    hideVolumeHUD: () => void;
    showSpeedHUD: (rate: number, isGestureActive?: boolean) => void;
    hideSpeedHUD: () => void;
    showResizeHUD: (mode: string) => void;
    hideResizeHUD: () => void;
    resetSpeed: () => void;
    updateZoom: (scale: number) => void;
    resetAll: () => void;
    showRipple: (x: number, y: number, side: 'left' | 'right') => void;
    hideRipple: () => void;
}

export interface UsePlayerTracksReturn {
    // Audio
    audioTracks: NativeAudioTrack[];
    selectedAudioTrackId: number | undefined;
    selectAudioTrack: (trackId: number | null) => void;

    // Subtitles
    subtitleTracks: SubtitleTrack[];
    selectedSubtitleTrackIndex: number | null;
    subtitleCues: SubtitleCue[];
    currentSubtitleCue: SubtitleCue | null;
    selectSubtitleTrack: (trackIndex: number | null) => void;

    // External subtitles
    externalSubtitles: ExternalSubtitle[];
    currentExternalName: string | null;
    loadExternalCues: (cues: SubtitleCue[], name: string, isSDH: boolean) => void;
    loadSDHForHaptics: (cues: SubtitleCue[], name: string) => void;

    // Haptic cues
    hapticCues: SubtitleCue[];

    // Selectors for TrackSelector component
    audioTracksForSelector: any[];
    subtitleTracksForSelector: any[];

    // Native VLC Text Track ID
    vlcTextTrackId?: number;

    // Actions
    setSubtitleCues: React.Dispatch<React.SetStateAction<SubtitleCue[]>>;
}

export interface UsePlayerBookmarksReturn {
    bookmarks: VideoBookmark[];
    showToast: boolean;
    toastMessage: string;
    toastIcon: string;
    toastKey: number;

    // Actions
    addBookmark: () => void;
    deleteBookmark: (bookmarkId: string) => void;
    jumpToBookmark: (timestamp: number) => void;
    hideToast: () => void;
    showToastWithMessage: (message: string, icon?: string) => void;
}

export interface UsePlayerSettingsReturn {
    settings: PlayerSettings;

    // Actions
    toggleMute: () => void;
    toggleRepeat: () => void;
    setDecoder: (decoder: 'hardware' | 'software' | 'hardware_plus') => void;
    setResizeMode: (mode: PlayerResizeMode) => void;
    toggleResizeMode: () => void;
    setSleepTimer: (minutes: number | null) => void;
    clearSleepTimer: () => void;
    toggleBackgroundPlay: () => void;
    toggleVideoEnhancement: () => void;

    // Equalizer Actions
    toggleEqualizer: () => void;
    setEqualizerPreset: (presetId: string) => void;
    setCustomEqualizerBands: (bands: number[]) => void;
    setSingleBand: (index: number, value: number) => void;

    // Synchronization Actions
    setAudioDelay: (delay: number) => void;
    setSubtitleDelay: (delay: number) => void;

    // Computed for Player
    audioEqualizer: number[] | undefined;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/** Route params for VideoPlayerScreen */
export interface VideoPlayerRouteParams {
    videoPath: string;
    videoName?: string;
    playMode?: string;
    albumName?: string;
    hapticCues?: SubtitleCue[];
    apiSubtitles?: any[];
    isExternalOpen?: boolean;
}

export interface VideoPlayerProps {
    route: { params: VideoPlayerRouteParams };
}

// ============================================================================
// HELPER FUNCTIONS (moved outside component for optimization)
// ============================================================================

/**
 * Format seconds to MM:SS or H:MM:SS string
 */
export const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) {return '00:00';}
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const mm = mins < 10 ? `0${mins}` : `${mins}`;
    const ss = secs < 10 ? `0${secs}` : `${secs}`;
    return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * RAF-based throttle for smooth UI updates
 */
export const rafThrottle = <T extends (...args: any[]) => void>(fn: T) => {
    let rafId: number | null = null;
    let lastArgs: any[] | null = null;
    return (...args: Parameters<T>) => {
        lastArgs = args;
        if (rafId !== null) {return;}
        rafId = requestAnimationFrame(() => {
            rafId = null;
            if (lastArgs) {
                fn(...(lastArgs as any[]));
                lastArgs = null;
            }
        });
    };
};

/**
 * Create a debounced function with cancel capability
 */
export const createDebounce = <T extends (...args: any[]) => void>(
    fn: T,
    delay: number
) => {
    let timeoutId: NodeJS.Timeout | null = null;
    const debounced = (...args: Parameters<T>) => {
        if (timeoutId) {clearTimeout(timeoutId);}
        timeoutId = setTimeout(() => {
            fn(...args);
            timeoutId = null;
        }, delay);
    };
    debounced.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };
    return debounced;
};

/**
 * Generate optimized VLC init options based on source and decoder
 */
export const getOptimizedInitOptions = (
    uri: string,
    decoder: 'hardware' | 'software' | 'hardware_plus',
    enableEnhancement: boolean = false
): string[] => {
    const isNetworkStream = uri.startsWith('http') || uri.startsWith('rtsp');

    const baseOptions = [
        '--no-video-title-show',
        '--no-sub-autodetect-file',
        // Removed --stats to save CPU cycles
        '--audio-filter=scaletempo',  // Essential for speed control
        // Removed heavy scaletempo search/overlap overrides (return to VLC defaults)
    ];

    // Only use fast-seek for local files
    if (!isNetworkStream) {
        baseOptions.push('--input-fast-seek');
    }

    // Video Enhancement Options ("Vivid Mode")
    if (enableEnhancement) {
        baseOptions.push(
            '--video-filter=adjust',
            '--brightness=1.03',
            '--contrast=1.08',
            '--saturation=1.30',
            '--gamma=0.95'
        );
    }

    // Decoder Options
    if (decoder === 'software') {
        baseOptions.push('--codec=avcodec');
    } else {
        // Hardware decoders
        if (enableEnhancement) {
            baseOptions.push(
                '--no-mediacodec-dr',
                '--no-omxil-dr'
            );
        }

        baseOptions.push(
            '--avcodec-fast',             // Standard speed optimization
            '--avcodec-skiploopfilter=1', // Safe quality compromise (skips only non-ref frames)
            '--avcodec-threads=0'
        );
    }

    if (isNetworkStream) {
        return [
            ...baseOptions,
            '--network-caching=600',
            '--live-caching=600',
            '--clock-jitter=0',
            '--http-reconnect',
        ];
    } else {
        return [
            ...baseOptions,
            '--file-caching=600', // Slight buffer increase (600ms) to smooth out speed changes
        ];
    }
};

