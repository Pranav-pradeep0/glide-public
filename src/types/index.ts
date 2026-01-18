// src/types/index.ts

export interface VideoFile {
    name: string;
    path: string;
    size: number;
    modifiedDate: number;
    duration: number; // in seconds
    isDirectory: boolean;
    album?: string;
}

export interface SubtitleCue {
    index: number;
    startTime: number; // in seconds
    endTime: number;
    text: string;
    soundEffect?: string;
}


export interface SubtitleResult {
    id: string;
    name: string;
    language: string;
    release: string;
    downloadUrl: string;
    author: string;
    rating: number;
    // SDH-related fields
    hearingImpaired?: boolean;
    sdhScore?: number;
    comment?: string;
}

export interface SubtitleSettings {
    fontSize: number;
    textColor: string;
    backgroundColor: string;
    verticalPosition: number;
    delay: number;
}

// Simplified Haptic-specific settings - single intensity value controls everything
export interface HapticSettings {
    enabled: boolean;
    intensity: number; // 1-255, controls all haptic strength (default: 128)
}

export interface AppSettings {
    darkMode: boolean;
    hapticSettings: HapticSettings;
    autoDownloadSubtitles: boolean;
    subtitleFontSize: number;
    subtitleColor: string;
    subtitleFontWeight: number; // 400-900
    subtitleOutlineWidth: number; // 0-6
    subtitleBackgroundColor: string;
    subtitleBackgroundOpacity: number;
    subtitleEdgeStyle: 'none' | 'outline' | 'dropShadow';
    subtitleFontFamily?: string;

    hasCompletedOnboarding: boolean;
    brightnessMode: 'global' | 'video';
    globalBrightness: number;

    // Playback settings
    showSeekButtons: boolean; // Show ±seek buttons in player controls
    seekDuration: number; // Seek duration in seconds (5, 10, 15, 30, 60)

    autoPlayNext: boolean; // Auto-play next video in folder
    defaultAudioLanguage: string | null; // Preferred audio language (matches substring in track name)
}

export interface PlayerState {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    isLoading: boolean;
    playbackRate: number;
    volume: number;
    isFullscreen: boolean;
    showControls: boolean;
    isControlsLocked: boolean;
}

export interface GestureState {
    brightness: number;
    volume: number;
    seekPosition: number;
}

export type SortOption = 'name' | 'date' | 'size';

export type PlayMode = 'with-haptics' | 'normal';

export type RootStackParamList = {
    Onboarding: undefined;
    MainTabs: undefined;
    PlayerDetail: {
        videoPath: string;
        videoName: string;
        albumName?: string;
        imdbId?: string;
    };
    VideoPlayer: {
        videoPath: string;
        videoName: string;
        cleanTitle?: string;
        albumName?: string;
        imdbId?: string;
        playMode?: PlayMode;
        subtitlePath?: string;
        // Pre-loaded haptic cues (independent of display subtitles)
        hapticCues?: SubtitleCue[];
        // API subtitles for user selection
        apiSubtitles?: SubtitleResult[];
        // If true, exit app on back press instead of navigating back
        isExternalOpen?: boolean;
    };
    AlbumVideos: {
        albumTitle: string;
        videoCount: number;
    };
};

export interface VideoBookmark {
    id: string;
    label?: string;
    timestamp: number;
    createdAt: number;
}

export interface VideoHistoryEntry {
    videoPath: string;
    videoName: string;
    lastWatchedTime: number; // timestamp when last watched
    lastPausedPosition: number; // seconds
    duration: number;
    viewCount: number;
    bookmarks: VideoBookmark[];
    thumbnailPath?: string;
    fileSize?: number;
    selectedAudioTrackId?: number;
    selectedSubtitleTrackId?: number; // Index of the subtitle track
    audioDelay?: number;
    subtitleDelay?: number;
    brightness?: number;
}

export type MainTabParamList = {
    Folders: undefined;
    Recents: undefined;
    Settings: undefined;
};
