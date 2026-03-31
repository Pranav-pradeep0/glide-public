
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    StyleSheet,
    View,
    useWindowDimensions,
    BackHandler,
    AppStateStatus,
    AppState,
    Platform,
    NativeModules,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SystemBars } from 'react-native-edge-to-edge';
import { PlayerResizeMode } from '@glide/vlc-player';

// Native Modules
const { AudioControlModule } = NativeModules;
import { enterPipMode, usePipModeListener } from '@/native/PipModule';

// Components
import AnimatedVideoView from '@/components/VideoPlayer/AnimatedVideoView';
import { VideoHUD } from '@/components/VideoPlayer/VideoHUD';
import { PlayerControls } from '@/components/VideoPlayer/PlayerControls';
import { LockButton } from '@/components/VideoPlayer/LockButton';
import { BookmarkToast } from '@/components/BookmarkToast';
import { BookmarkPanel } from '@/components/VideoPlayer/BookmarkPanel';
import { QuickSettingsPanel } from '@/components/VideoPlayer/QuickSettingsPanel';
import { PlaylistPanel } from '@/components/VideoPlayer/PlaylistPanel';
import { SubtitleOverlay, SubtitleSettings } from '@/components/SubtitleOverlay';
import { TrackSelector } from '@/components/TrackSelector';
import { EqualizerModal } from '@/components/EqualizerModal';
import { FloatingSyncPanel } from '@/components/FloatingSyncPanel';
import { RecapModal } from '@/components/VideoPlayer/RecapModal';
import { ResumeModal } from '@/components/VideoPlayer/ResumeModal';
import { RecapService } from '@/services/RecapService';

// Hooks
import {
    usePlayerCore,
    usePlayerUI,
    usePlayerHUD,
    usePlayerGestures,
    usePlayerTracks,
    usePlayerBookmarks,
    usePlayerSettings,
    useShakeControl,
    formatTime,
    PLAYER_CONSTANTS,
} from '@/hooks/video-player';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { useTheme } from '@/hooks/useTheme';
import { useAlbumVideos } from '@/hooks/useMediaService';

// Services and stores
import { VideoOrientationService } from '@/services/VideoOrientationService';
import { HapticEngineService } from '@/services/HapticEngineService';
import { NavigationService } from '@/services/NavigationService';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { useAppStore } from '@/store/appStore';

// Types
import { SubtitleCue, VideoFile } from '@/types';

// ============================================================================
// TYPES
// ============================================================================

type RouteParams = {
    videoPath: string;
    videoName?: string;
    contentUri?: string; // Original content:// URI for CameraRoll operations
    playMode?: string;
    albumName?: string;
    hapticCues?: SubtitleCue[];
    apiSubtitles?: any[];
    isExternalOpen?: boolean;
    imdbId?: string;
    cleanTitle?: string;
};

type Props = {
    route: { params: RouteParams };
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function VideoPlayerScreen({ route }: Props) {
    const {
        videoPath,
        videoName = 'Video',
        contentUri, // Original content:// URI for history storage
        hapticCues: routeHapticCues,
        apiSubtitles,
        isExternalOpen,
        playMode,
        albumName: routeAlbumName,
        imdbId,
        cleanTitle,
    } = route.params;

    // Derive album name from parent folder if not provided
    const albumName = useMemo(() => {
        if (routeAlbumName) {return routeAlbumName;}
        // Extract parent folder name from video path
        const parts = videoPath.replace(/\\/g, '/').split('/');
        if (parts.length >= 2) {
            return parts[parts.length - 2]; // Parent folder
        }
        return null;
    }, [videoPath, routeAlbumName]);

    // ========================================================================

    // Define navigation param list mapping for type safety (partial)
    type RootStackParamList = {
        VideoPlayer: RouteParams;
    };

    const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const theme = useTheme();

    // Store actions
    const getVideoHistory = useVideoHistoryStore(state => state.getVideoHistory);
    const updatePlaybackPosition = useVideoHistoryStore(state => state.updatePlaybackPosition);
    const incrementViewCount = useVideoHistoryStore(state => state.incrementViewCount);
    const persistNow = useVideoHistoryStore(state => state.persistNow);

    // Global settings
    const { settings, updateSettings } = useAppStore();

    // Track if view has been counted
    const hasIncrementedView = useRef(false);
    const controlsInsetsRef = useRef(insets);
    const savePlaybackRef = useRef<() => void>(() => { });
    const persistNowRef = useRef(persistNow);
    const isMounted = useRef(true);

    useEffect(() => {
        return () => {
            isMounted.current = false;
        };
    }, []);

    // Brightness tracking
    const brightnessRef = useRef<number | undefined>(undefined);

    // Inactivity tracking for Recap
    const lastPauseTimeRef = useRef<number | null>(null);
    const RECAP_INACTIVITY_THRESHOLD = 5 * 60 * 1000; // 5 minutes

    // ========================================================================
    // VIDEO SOURCE
    // ========================================================================

    const source = useMemo(() => {
        if (videoPath.startsWith('http://') ||
            videoPath.startsWith('https://') ||
            videoPath.startsWith('rtsp://') ||
            videoPath.startsWith('rtmp://')) {
            return { uri: videoPath, isNetwork: true };
        }
        if (videoPath.startsWith('content://')) {
            return { uri: videoPath, isNetwork: false };
        }
        let finalUri = videoPath;
        if (videoPath.startsWith('file://')) {
            finalUri = videoPath.substring(7);
        }
        if (!finalUri.startsWith('/')) {
            finalUri = `/${finalUri}`;
        }
        return { uri: finalUri, isNetwork: false };
    }, [videoPath]);

    const isLandscape = useMemo(() => width > height, [width, height]);
    const isNetworkStream = useMemo(() => NavigationService.isNetworkStream(videoPath), [videoPath]);

    // UI and HUD hooks (needed by handlers below)
    const ui = usePlayerUI();
    const hud = usePlayerHUD();

    // ========================================================================
    // ORIENTATION LOCK STATE
    // ========================================================================

    const [equalizerVisible, setEqualizerVisible] = React.useState(false);

    const [orientationLocked, setOrientationLocked] = React.useState(false);
    const [syncPanelType, setSyncPanelType] = React.useState<'audio' | 'subtitle' | null>(null);
    const [basePlaybackRate, setBasePlaybackRate] = React.useState(1.0);
    const [temporaryHoldRate, setTemporaryHoldRate] = React.useState<number | null>(null);
    const [shakeEnabled, setShakeEnabled] = React.useState(false);
    const [shakeAction, setShakeAction] = React.useState<'play_pause' | 'next' | 'previous' | 'seek_forward' | 'seek_backward'>('play_pause');

    // AI Recap State
    const [recapVisible, setRecapVisible] = React.useState(false);
    const [recapText, setRecapText] = React.useState<string | null>(null);
    const [isGeneratingRecap, setIsGeneratingRecap] = React.useState(false);
    const [recapLoadingMessage, setRecapLoadingMessage] = React.useState<string | undefined>(undefined);

    const handleToggleOrientationLock = useCallback(() => {
        if (orientationLocked) {
            // Unlock -> Enable Auto
            VideoOrientationService.enableAuto();
            setOrientationLocked(false);
        } else {
            // Lock -> Disable Auto (Locks to current)
            VideoOrientationService.disableAuto();
            setOrientationLocked(true);
        }
        ui.showControls();
        ui.scheduleAutoHide();
    }, [orientationLocked, ui]);

    // ========================================================================
    // NIGHT MODE STATE
    // ========================================================================

    // Night Mode simply puts a semi-transparent black overlay over the video
    const [nightMode, setNightMode] = React.useState(false);

    const toggleNightMode = useCallback(() => {
        setNightMode(prev => !prev);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [ui]);

    // Haptics State (User toggle)
    const [hapticsEnabled, setHapticsEnabled] = React.useState(true);

    const effectivePlaybackRate = useMemo(
        () => temporaryHoldRate ?? basePlaybackRate,
        [temporaryHoldRate, basePlaybackRate]
    );

    // ========================================================================
    // HISTORY HELPERS
    // ========================================================================

    const getResumeState = useCallback(() => {
        const history = getVideoHistory(videoPath);
        if (history) {
            return {
                resumePosition: (history.lastPausedPosition > 1 && history.duration > 0) ? history.lastPausedPosition : null,
                audioTrackId: history.selectedAudioTrackId,
                subtitleTrackIndex: history.selectedSubtitleTrackId,
                audioDelay: history.audioDelay,
                subtitleDelay: history.subtitleDelay,
                brightness: history.brightness,
                duration: history.duration,
            };
        }
        return { resumePosition: null };
    }, [videoPath, getVideoHistory]);

    // Get initial state once
    const {
        resumePosition,
        audioTrackId: initialAudioTrackId,
        subtitleTrackIndex: initialSubtitleTrackIndex,
        audioDelay: initialAudioDelay,
        subtitleDelay: initialSubtitleDelay,
        brightness: initialVideoBrightness,
        duration: savedDuration,
    } = useMemo(() => getResumeState(), [getResumeState]);

    // Determine initial brightness based on mode
    const startBrightness = useMemo(() => {
        if (settings.brightnessMode === 'global') {
            return settings.globalBrightness;
        }
        return initialVideoBrightness;
    }, [settings.brightnessMode, settings.globalBrightness, initialVideoBrightness]);

    // Calculate resume state upfront to avoid flash
    const shouldResume = useMemo(() => {
        return !isNetworkStream && !!(resumePosition && resumePosition > 15);
    }, [resumePosition, isNetworkStream]);

    const [resumeModalVisible, setResumeModalVisible] = React.useState(shouldResume);

    // Memoize resume modal data to prevent recalculations on every render during animations
    const resumeModalData = useMemo(() => {
        if (!resumePosition) {return null;}

        const remaining = savedDuration ? Math.max(0, savedDuration - resumePosition) : 0;
        // Calculate finish time once based on current time when history is loaded
        const finishBy = savedDuration
            ? new Date(Date.now() + remaining * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : undefined;

        return {
            formattedTime: formatTime(resumePosition),
            remainingTime: savedDuration ? remaining : undefined,
            finishByTime: finishBy,
            showRecap: !isNetworkStream && resumePosition > 120 && (!!imdbId || !!albumName),
        };
    }, [resumePosition, savedDuration, imdbId, albumName, isNetworkStream]);

    // ========================================================================
    // PLAYER HOOKS (ORDER MATTERS - dependencies flow down)
    // ========================================================================

    // Settings hook (independent, needed by other hooks)
    const settingsHook = usePlayerSettings({
        showToast: (message, icon) => bookmarksHook.showToastWithMessage(message, icon),
        onSleepTimerEnd: () => {
            player.stop();
            navigation.goBack();
        },
        initialAudioDelay,
        initialSubtitleDelay,
    });

    // Core player hook
    const player = usePlayerCore({
        videoPath,
        getResumePosition: () => resumePosition, // Adapt to hook's expected signature
        repeat: settingsHook.settings.repeat,
        sleepTimer: settingsHook.settings.sleepTimer,
        onSleepTimerEnd: () => {
            player.stop();
            navigation.goBack();
        },
        onProgressSave: () => savePlaybackRef.current(),
        onAudioTracksLoaded: (tracks) => {
            (tracksHook as any).setAudioTracksFromVLC?.(tracks);
        },
        initialPaused: false,
        playbackRate: effectivePlaybackRate,
    });

    // PIP Mode State from native listener
    const isInPipMode = usePipModeListener();

    // Hide controls when entering PIP mode (simple effect, no state toggling)
    useEffect(() => {
        if (isInPipMode) {
            ui.hideControls();

            // Handle brightness for PiP
            if (settings.pipBrightnessMode === 'system') {
                // Determine if we need to switch to system brightness
                // If brightness was modified, revert to system (-1)
                AudioControlModule.resetBrightness?.();
            }
        } else {
            // Exiting PiP - restore player brightness if needed
            if (settings.pipBrightnessMode === 'system' && brightnessRef.current !== undefined) {
                // Convert 0-1 brightness to 0-1 float for setBrightness
                // brightnessRef.current is already 0-1
                AudioControlModule.setBrightness?.(brightnessRef.current);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInPipMode, settings.pipBrightnessMode]);

    // Gestures hook
    const gestures = usePlayerGestures({
        player,
        ui,
        hud,
        basePlaybackRate,
        onTemporarySpeedChange: setTemporaryHoldRate,
        initialBrightness: startBrightness,
        onBrightnessChange: (val) => {
            brightnessRef.current = val;
        },
        onBrightnessSave: (val) => {
            if (settings.brightnessMode === 'global') {
                updateSettings({ globalBrightness: val });
            }
        },
    });

    // Tracks hook
    const tracksHook = usePlayerTracks({
        videoPath,
        currentTimeRef: player.currentTimeRef,
        routeHapticCues,
        initialAudioTrackId: initialAudioTrackId,
        initialSubtitleTrackIndex: initialSubtitleTrackIndex,
        subtitleDelay: settingsHook.settings.subtitleDelay,
        defaultAudioLanguage: settings.defaultAudioLanguage,
    });

    // Bookmarks hook (needs player for seek)
    const bookmarksHook = usePlayerBookmarks({
        videoPath,
        videoName,
        duration: player.state.duration,
        currentTimeRef: player.currentTimeRef,
        onSeekToBookmark: player.commitSeek,
    });

    // ========================================================================
    // SAVING LOGIC (Defined after hooks to avoid circular dependencies)
    // ========================================================================

    const savePlaybackProgress = useCallback(() => {
        if (!videoPath || !videoName) {return;}

        const isNetwork = NavigationService.isNetworkStream(videoPath);
        if (isNetwork) {return;}

        if (player.state.duration > 0) {
            // Guard: If we have a resume position but the player is still at 0 (or near 0),
            // and we haven't played past it, assume the resume seek hasn't happened yet.
            // This prevents overwriting deep history with 0 on immediate exit.
            const currentTime = player.currentTimeRef.current;
            if (resumePosition && resumePosition > 10 && currentTime < 2) {
                if (__DEV__) {console.log('[VideoPlayer] Skipping save: Player at start but resume expected at', resumePosition);}
                return;
            }

            updatePlaybackPosition(
                videoPath,
                videoName,
                currentTime,
                player.state.duration,
                tracksHook.selectedAudioTrackId,
                tracksHook.selectedSubtitleTrackIndex ?? undefined,
                settingsHook.settings.audioDelay,
                settingsHook.settings.subtitleDelay,
                // Only save brightness to history if in video mode
                settings.brightnessMode === 'video' ? brightnessRef.current : undefined
            );
        }
    }, [
        videoPath,
        videoName,
        updatePlaybackPosition,
        player.state.duration,
        player.currentTimeRef,
        tracksHook.selectedAudioTrackId,
        tracksHook.selectedSubtitleTrackIndex,
        settingsHook.settings.audioDelay,
        settingsHook.settings.subtitleDelay,
        settings.brightnessMode,
        resumePosition,
    ]);

    // Keep ref updated for usePlayerCore
    useEffect(() => {
        savePlaybackRef.current = savePlaybackProgress;
    }, [savePlaybackProgress]);

    // Keep persist action stable for unmount cleanup
    useEffect(() => {
        persistNowRef.current = persistNow;
    }, [persistNow]);

    // Force synchronous save (atomic write)
    const forceSave = useCallback(() => {
        savePlaybackProgress();
        persistNow();
    }, [savePlaybackProgress, persistNow]);

    // ========================================================================
    // HAPTIC FEEDBACK
    // ========================================================================

    // ========================================================================
    // HAPTIC FEEDBACK
    // ========================================================================

    useHapticFeedback({
        enabled: playMode === 'with-haptics' && hapticsEnabled,
        currentTime: player.currentTimeRef.current,
        // Use displayed subtitles if available (WYSIWYG), otherwise fallback to pre-loaded haptic cues
        subtitleCues: tracksHook.subtitleCues.length > 0 ? tracksHook.subtitleCues : tracksHook.hapticCues,
        isPlaying: player.state.isPlaying,
        subtitleDelay: settingsHook.settings.subtitleDelay,
    });

    // ========================================================================
    // DERIVED VALUES
    // ========================================================================

    // Use exact device metrics for static margins to avoid "wasted" space while ensuring safety
    const effectiveInsets = useMemo(() => {
        const topInset = initialWindowMetrics?.insets.top ?? 0;
        // Use the actual notch height, but ensure at least 16px padding
        // This is tighter than the previous generic 50px bucket
        const safeMargin = Math.max(topInset, 16);

        return {
            top: safeMargin,
            bottom: 20, // Bottom usually needs less clearance (gesture bar is small)
            left: safeMargin,
            right: safeMargin,
        };
    }, []);

    const subtitleSettings = useMemo<SubtitleSettings>(() => {
        let fontFamily = settings.subtitleFontFamily || Platform.select({ android: 'Roboto', ios: 'System', default: 'System' });
        let fontWeight: SubtitleSettings['fontWeight'] = String(settings.subtitleFontWeight) as any;

        if (fontFamily === 'NetflixSans-Medium') {

            const weightNum = Number(settings.subtitleFontWeight);

            if (weightNum >= 700) {
                fontFamily = 'NetflixSans-Bold';
                fontWeight = 'normal';
            } else if (weightNum <= 300) {
                fontFamily = 'NetflixSans-Light';
                fontWeight = 'normal';
            } else {
                fontFamily = 'NetflixSans-Medium';
                fontWeight = 'normal';
            }
        }

        return {
            fontSize: settings.subtitleFontSize,
            fontColor: settings.subtitleColor,
            fontWeight: fontWeight,
            fontFamily: fontFamily,
            backgroundColor: settings.subtitleBackgroundColor,
            backgroundOpacity: settings.subtitleBackgroundColor === 'transparent' ? 0 : settings.subtitleBackgroundOpacity,
            // If edge style is outline or dropShadow, use black, else transparent
            outlineColor: settings.subtitleEdgeStyle !== 'none' ? '#000000' : 'transparent',
            // Use outlineWidth from settings when outline is enabled
            outlineWidth: settings.subtitleEdgeStyle === 'none' ? 0 : settings.subtitleOutlineWidth,
            position: 'bottom',
        };
    }, [settings]);

    const shouldShowBuffer = useMemo(() =>
        player.state.isVideoLoaded && player.state.isBuffering && !player.state.isSeeking,
        [player.state.isVideoLoaded, player.state.isBuffering, player.state.isSeeking]
    );

    // ========================================================================
    // NAVIGATION HANDLERS
    // ========================================================================

    const handleGoBack = useCallback(() => {
        forceSave();
        player.stop();
        VideoOrientationService.release();

        if (isExternalOpen) {
            BackHandler.exitApp();
        } else {
            navigation.goBack();
        }
        ui.showControls();
        ui.scheduleAutoHide();
    }, [navigation, forceSave, player, isExternalOpen, ui]);

    const handlePlayVideo = useCallback((video: VideoFile) => {
        ui.closeAllPanels();
        // @ts-ignore
        navigation.replace('VideoPlayer', {
            videoPath: video.path,
            videoName: video.name,
        });
    }, [navigation, ui]);

    // ========================================================================
    // CONTROL HANDLERS
    // ========================================================================

    const handleToggleResizeMode = useCallback(() => {
        // Calculate next mode directly here to sync with HUD
        const modes: PlayerResizeMode[] = ['best-fit', 'contain', 'cover', 'fill', 'scale-down', 'none'];
        const currentMode = settingsHook.settings.resizeMode;
        const nextIndex = (modes.indexOf(currentMode) + 1) % modes.length;
        const nextMode = modes[nextIndex];

        // Update settings and show HUD
        settingsHook.setResizeMode(nextMode);
        hud.showResizeHUD(nextMode);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [settingsHook, hud, ui]);

    const handleToggleHaptics = useCallback(() => {
        setHapticsEnabled(prev => {
            const next = !prev;
            bookmarksHook.showToastWithMessage(`Haptics ${next ? 'Enabled' : 'Disabled'}`, 'haptics');
            if (next) {
                HapticEngineService.getInstance().triggerUIFeedback('light');
            }
            return next;
        });
        ui.showControls();
        ui.scheduleAutoHide();
    }, [bookmarksHook, ui]);

    const handleEnterPip = useCallback(() => {
        enterPipMode(16, 9);
    }, []);

    const handleTogglePlayPause = useCallback(() => {
        player.togglePlayPause();
        ui.showControls();
        ui.scheduleAutoHide();
    }, [player, ui]);

    const handleSlidingStart = useCallback(() => {
        ui.cancelAutoHide();
        player.setIsSeeking(true);
        // Capture start time for difference display
        hud.setSeekStartTime(player.currentTimeRef.current);
    }, [ui, hud, player]);

    const handleSliderChange = useCallback((val: number) => {
        // Update shared value for smooth HUD display
        gestures.sharedValues.seekTime.value = val;
        player.previewSeek(val);
        hud.showSeekHUD(val, null, null, true); // isGestureActive=true
    }, [player, hud, gestures]);

    const handleSliderChangeComplete = useCallback((val: number) => {
        player.commitSeek(val);
        hud.showSeekHUD(val, null, null, false); // isGestureActive=false, will auto-hide
        ui.showControls();
        ui.scheduleAutoHide();
    }, [player, hud, ui]);

    // Jump handlers
    const handleJumpBackward = useCallback(() => {
        // If HUD is already showing seek, use its value as base for accumulation
        const isCurrentlySeeking = hud.state.seek.show;
        const baseTime = isCurrentlySeeking
            ? gestures.sharedValues.seekTime.value
            : player.currentTimeRef.current;

        const seekTime = settings.seekDuration || 30;
        const newTime = Math.max(0, baseTime - seekTime);

        // Set start time for difference display - false means don't reset if already seeking
        hud.setSeekStartTime(player.currentTimeRef.current, false);

        gestures.sharedValues.seekTime.value = newTime;
        player.commitSeek(newTime);
        hud.showSeekHUD(newTime, 'backward', null, false);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [player, hud, gestures, ui, settings.seekDuration]);

    const handleJumpForward = useCallback(() => {
        // If HUD is already showing seek, use its value as base for accumulation
        const isCurrentlySeeking = hud.state.seek.show;
        const baseTime = isCurrentlySeeking
            ? gestures.sharedValues.seekTime.value
            : player.currentTimeRef.current;

        const seekTime = settings.seekDuration || 30;
        const newTime = Math.min(player.state.duration, baseTime + seekTime);

        // Set start time for difference display - false means don't reset if already seeking
        hud.setSeekStartTime(player.currentTimeRef.current, false);

        gestures.sharedValues.seekTime.value = newTime;
        player.commitSeek(newTime);
        hud.showSeekHUD(newTime, 'forward', null, false);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [player, hud, gestures, ui, settings.seekDuration]);

    // ========================================================================
    // QUICK SETTINGS HANDLERS (Memoized)
    // ========================================================================

    const handleQSClose = useCallback(() => ui.closePanel('quickSettings'), [ui]);
    const handleQSOpenPlaylist = useCallback(() => {
        ui.closePanel('quickSettings');
        ui.openPanel('playlist');
    }, [ui]);
    const handleQSOpenAudio = useCallback(() => {
        ui.closePanel('quickSettings');
        ui.openPanel('audioSelector');
    }, [ui]);
    const handleQSOpenSubtitle = useCallback(() => {
        ui.closePanel('quickSettings');
        ui.openPanel('subtitleSelector');
    }, [ui]);
    const handleQSOpenBookmarkPanel = useCallback(() => {
        ui.closePanel('quickSettings');
        ui.openPanel('bookmarkPanel'); // Assuming 'bookmarkPanel' is the key
    }, [ui]);

    // ========================================================================
    // MEMOIZED CONTROL HANDLERS (Optimization)
    // ========================================================================

    const handleToggleAudio = useCallback(() => ui.openPanel('audioSelector'), [ui]);
    const handleToggleSubtitle = useCallback(() => ui.openPanel('subtitleSelector'), [ui]);

    const handleAddBookmark = useCallback(() => {
        bookmarksHook.addBookmark();
        ui.scheduleAutoHide();
    }, [bookmarksHook, ui]);

    const handleToggleQuickSettings = useCallback(() => ui.openPanel('quickSettings'), [ui]);
    const handleToggleBookmarkPanel = useCallback(() => ui.openPanel('bookmarkPanel'), [ui]);
    const handleTogglePlaylist = useCallback(() => ui.openPanel('playlist'), [ui]);

    const handleToggleSpeed = useCallback(() => {
        // Cycle speed: 1.0 -> 1.5 -> 2.0 -> 2.5 -> 3.0 -> 0.5 -> 1.0
        const rates = [1.0, 1.5, 2.0, 2.5, 3.0, 0.5];
        const currentRate = basePlaybackRate;
        const currentIndex = rates.indexOf(currentRate);
        const nextIndex = ((currentIndex >= 0 ? currentIndex : 0) + 1) % rates.length;
        const nextRate = rates[nextIndex];
        setTemporaryHoldRate(null);
        setBasePlaybackRate(nextRate);
        hud.showSpeedHUD(nextRate, false);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [basePlaybackRate, hud, ui]);

    const handlePlaybackRateChange = useCallback((rate: number) => {
        setTemporaryHoldRate(null);
        setBasePlaybackRate(rate);
        hud.showSpeedHUD(rate, false);
        ui.showControls();
        ui.scheduleAutoHide();
    }, [hud, ui]);

    const handleToggleBackgroundPlay = useCallback(() => {
        settingsHook.toggleBackgroundPlay();
        ui.showControls();
        ui.scheduleAutoHide();
    }, [settingsHook, ui]);

    // ========================================================================
    // PLAYLIST NAVIGATION
    // ========================================================================

    // Get album videos for playlist navigation
    const { videos: albumVideos } = useAlbumVideos(albumName || null);

    // Find current video index in playlist
    const currentVideoIndex = useMemo(() => {
        return albumVideos.findIndex(v => v.path === videoPath);
    }, [albumVideos, videoPath]);

    // Calculate if we have prev/next videos
    const hasPrevious = currentVideoIndex > 0;
    const hasNext = currentVideoIndex >= 0 && currentVideoIndex < albumVideos.length - 1;

    const handlePrevious = useCallback(() => {
        if (!hasPrevious) {return;}
        const prevVideo = albumVideos[currentVideoIndex - 1];
        if (prevVideo) {
            ui.closeAllPanels();
            navigation.replace('VideoPlayer', {
                videoPath: prevVideo.path,
                videoName: prevVideo.name,
                albumName: albumName || undefined,
                playMode: playMode,
            });
        }
    }, [hasPrevious, albumVideos, currentVideoIndex, ui, navigation, albumName, playMode]);

    const handleNext = useCallback(() => {
        if (!hasNext) {return;}
        const nextVideo = albumVideos[currentVideoIndex + 1];
        if (nextVideo) {
            ui.closeAllPanels();
            navigation.replace('VideoPlayer', {
                videoPath: nextVideo.path,
                videoName: nextVideo.name,
                albumName: albumName || undefined,
                playMode: playMode,
            });
        }
    }, [hasNext, albumVideos, currentVideoIndex, ui, navigation, albumName, playMode]);

    const handleShakeAction = useCallback(() => {
        if (shakeAction === 'play_pause') {
            handleTogglePlayPause();
            return;
        }
        if (shakeAction === 'next') {
            if (!isNetworkStream && hasNext) { handleNext(); }
            return;
        }
        if (shakeAction === 'previous') {
            if (!isNetworkStream && hasPrevious) { handlePrevious(); }
            return;
        }
        if (shakeAction === 'seek_forward') {
            handleJumpForward();
            return;
        }
        if (shakeAction === 'seek_backward') {
            handleJumpBackward();
        }
    }, [
        shakeAction,
        handleTogglePlayPause,
        handleNext,
        handlePrevious,
        handleJumpForward,
        handleJumpBackward,
        hasNext,
        hasPrevious,
        isNetworkStream,
    ]);

    useShakeControl({
        enabled: shakeEnabled,
        onShake: handleShakeAction,
        shakeThreshold: settings.shakeThreshold,
        isLocked: ui.state.locked,
        isSeeking: player.state.isSeeking,
        isInPip: isInPipMode,
        isQuickSettingsOpen: ui.state.quickSettingsOpen,
    });

    const handleVideoEnd = useCallback(() => {
        // Always call default player end handler to ensure clean state
        player.handleEnd();

        // Check for auto-play
        // Delay slightly to let player state settle and ensure smooth transition
        setTimeout(() => {
            if (settings.autoPlayNext && hasNext) {
                handleNext();
            }
        }, 500);
    }, [player, settings.autoPlayNext, hasNext, handleNext]);

    // AI Recap Logic - shows modal immediately with skeleton loading
    // Use a ref to get fresh subtitle cues during polling
    const subtitleCuesRef = useRef(tracksHook.subtitleCues);
    subtitleCuesRef.current = tracksHook.subtitleCues;

    const subtitleTracksRef = useRef(tracksHook.subtitleTracks);
    subtitleTracksRef.current = tracksHook.subtitleTracks;

    const handleRecapTrigger = useCallback(async () => {
        if (isNetworkStream) {return;}
        // If we already have recap text, just show it
        if (recapText) {
            player.pause();
            setResumeModalVisible(false);
            setRecapVisible(true);
            return;
        }

        if (!resumePosition) {return;}

        // Pause player and show RecapModal immediately with loading state
        player.pause();
        setResumeModalVisible(false);
        setRecapVisible(true);
        setIsGeneratingRecap(true);

        // Helper function for user feedback
        const setFeedback = (msg: string) => {
            if (isMounted.current) {setRecapLoadingMessage(msg);}
        };

        // Get dialogue through the centralized service
        try {
            setFeedback('Analyzing subtitles...');
            const dialogue = await RecapService.getDialogueForRecap(
                videoPath,
                tracksHook.subtitleTracks,
                subtitleCuesRef.current,
                resumePosition,
                cleanTitle || videoName
            );

            if (!isMounted.current) {return;}

            if (!dialogue) {
                setRecapText(null);
                setRecapVisible(false);
                setIsGeneratingRecap(false);
                setRecapLoadingMessage(undefined);
                bookmarksHook.showToastWithMessage('Not enough dialogue for a recap', 'recap');
                return;
            }

            setFeedback('Generating your recap...');
            const summary = await RecapService.generateRecap(dialogue, cleanTitle || videoName);

            if (!isMounted.current) {return;}

            if (summary) {
                setRecapText(summary);
                setRecapLoadingMessage(undefined);
            } else {
                setRecapText(null);
                setRecapVisible(false);
                setRecapLoadingMessage(undefined);
                bookmarksHook.showToastWithMessage('Recap generation failed', 'error');
            }
        } catch (error) {
            console.error('[VideoPlayerScreen] Recap error:', error);
            if (isMounted.current) {
                setRecapText(null);
                setRecapVisible(false);
                setRecapLoadingMessage(undefined);
                bookmarksHook.showToastWithMessage('Recap generation error', 'error');
            }
        } finally {
            if (isMounted.current) {
                setIsGeneratingRecap(false);
            }
        }
    }, [recapText, resumePosition, bookmarksHook, player, cleanTitle, videoName, videoPath, tracksHook.subtitleTracks, isNetworkStream]);

    // Inactivity Prompt Logic
    useEffect(() => {
        if (player.state.paused) {
            // Only set if not already set (e.g. from a previous pause)
            if (!lastPauseTimeRef.current) {
                lastPauseTimeRef.current = Date.now();
            }
        } else {
            // When resuming, check how long it was paused
            if (lastPauseTimeRef.current) {
                const pauseDuration = Date.now() - lastPauseTimeRef.current;
                // If paused for > threshold, show the resume modal again to offer a recap
                if (!isNetworkStream && pauseDuration > RECAP_INACTIVITY_THRESHOLD && !resumeModalVisible && !recapVisible) {
                    setResumeModalVisible(true);
                    player.pause();
                }
            }
            lastPauseTimeRef.current = null;
        }
    }, [player.state.paused, resumeModalVisible, recapVisible, isNetworkStream]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleResumeModalAction = useCallback((action: 'resume' | 'restart' | 'recap') => {
        if (action === 'resume') {
            setResumeModalVisible(false);
            player.play();
        } else if (action === 'restart') {
            const effectiveDuration =
                player.state.duration > 0
                    ? player.state.duration
                    : (savedDuration ?? 0);

            // Reset persisted resume point immediately so old history cannot reappear.
            if (videoPath && videoName) {
                updatePlaybackPosition(
                    videoPath,
                    videoName,
                    0,
                    effectiveDuration,
                    tracksHook.selectedAudioTrackId,
                    tracksHook.selectedSubtitleTrackIndex ?? undefined,
                    settingsHook.settings.audioDelay,
                    settingsHook.settings.subtitleDelay,
                    settings.brightnessMode === 'video' ? brightnessRef.current : undefined
                );
                persistNow();
            }

            setResumeModalVisible(false);
            player.clearResumePosition();
            player.commitSeek(0);
            player.play();
        } else if (action === 'recap') {
            // Don't close modal yet - handleRecapTrigger will show RecapModal or toast
            // Modal will be hidden when recap is successful or on close button
            handleRecapTrigger();
        }
    }, [
        player,
        handleRecapTrigger,
        savedDuration,
        videoPath,
        videoName,
        updatePlaybackPosition,
        tracksHook.selectedAudioTrackId,
        tracksHook.selectedSubtitleTrackIndex,
        settingsHook.settings.audioDelay,
        settingsHook.settings.subtitleDelay,
        settings.brightnessMode,
        persistNow,
    ]);

    // ========================================================================
    // LIFECYCLE EFFECTS
    // ========================================================================

    // Initial tracks loading
    useEffect(() => {
        // We no longer call evict() on unmount here.
        // Memory is managed by SubtitleCueStore's LRU (Limit: 5 videos)
        // and files are deleted instantly after parsing.
        // This makes backtracking to Details screen instant without FFmpeg.
    }, []);

    // Update insets ref when controls are visible
    useEffect(() => {
        if (ui.state.controlsVisible && !ui.state.quickSettingsOpen) {
            controlsInsetsRef.current = insets;
        }
    }, [insets, ui.state.controlsVisible, ui.state.quickSettingsOpen]);

    // Pause when quick settings is open
    useEffect(() => {
        if (ui.state.quickSettingsOpen && player.state.isPlaying) {
            player.pause();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ui.state.quickSettingsOpen, player.state.isPlaying]);

    // App state handling - respect background play setting
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
            if (nextState === 'background' || nextState === 'inactive') {
                // We rely on the native player's onHostPause to handle background behavior.
                // But we MUST save progress synchronously here to prevent data loss if app is killed.
                forceSave();
            }
        });
        return () => subscription.remove();
    }, [forceSave]);

    // Increment view count on first play
    useEffect(() => {
        const isNetwork = NavigationService.isNetworkStream(videoPath);
        if (!isNetwork && player.state.isPlaying && !hasIncrementedView.current && videoPath && videoName) {
            incrementViewCount(videoPath, videoName, contentUri); // Pass contentUri for history storage
            hasIncrementedView.current = true;
        }
    }, [player.state.isPlaying, videoPath, videoName, contentUri, incrementViewCount]);

    // Periodic progress save
    useEffect(() => {
        if (!player.state.isPlaying || !videoPath || !videoName) {return;}

        const intervalId = setInterval(() => {
            savePlaybackProgress();
        }, PLAYER_CONSTANTS.PROGRESS_SAVE_INTERVAL_MS);

        return () => clearInterval(intervalId);
    }, [player.state.isPlaying, videoPath, videoName, savePlaybackProgress]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            player.videoRef.current?.stopPlayer();
            const isNetwork = NavigationService.isNetworkStream(videoPath);
            if (!isNetwork) {
                savePlaybackRef.current();
                persistNowRef.current();
            }
        };
        // videoPath is route-static for this screen instance; refs hold latest save actions.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Set orientation immediately on mount (avoid waiting for nav transition).
    useEffect(() => {
        VideoOrientationService.enableAuto();
        return () => {
            VideoOrientationService.release();
        };
    }, []);

    // Back button handler
    useEffect(() => {
        const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
            handleGoBack();
            return true;
        });
        return () => backHandler.remove();
    }, [handleGoBack]);

    // Navigation beforeRemove
    useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', () => {
            forceSave();
            player.stop();
            VideoOrientationService.release();
        });
        return unsubscribe;
    }, [navigation, forceSave, player]);

    // System bars
    useEffect(() => {
        SystemBars.setHidden(!ui.state.controlsVisible);
        SystemBars.setStyle('auto');
        return () => {
            SystemBars.setHidden(false);
            SystemBars.setStyle(theme.dark ? 'light' : 'dark');
        };
    }, [ui.state.controlsVisible, theme.dark]);

    // ========================================================================
    // RENDER
    // ========================================================================

    return (
        <View style={styles.container}>
            {/* Video with gestures */}
            <GestureDetector gesture={gestures.composedGesture}>
                <View style={[StyleSheet.absoluteFill, { zIndex: 0 }]}>
                    <AnimatedVideoView
                        ref={player.videoRef}
                        source={source}
                        playerKey={settingsHook.settings.playerKey}
                        decoder={settingsHook.settings.decoder}
                        paused={player.state.paused || resumeModalVisible || recapVisible}
                        rate={effectivePlaybackRate}
                        muted={settingsHook.settings.muted || resumeModalVisible}
                        repeat={settingsHook.settings.repeat}
                        resizeMode={settingsHook.settings.resizeMode}
                        playInBackground={settingsHook.settings.backgroundPlayEnabled}
                        currentTime={player.currentTimeRef.current}
                        duration={player.state.duration}
                        videoEnhancement={settingsHook.settings.videoEnhancement}
                        audioTrack={tracksHook.selectedAudioTrackId}
                        textTrack={tracksHook.vlcTextTrackId ?? -1}
                        title={videoName}
                        artist={albumName || 'Glide'}
                        animatedStyle={gestures.videoAnimatedStyle}
                        audioEqualizer={settingsHook.audioEqualizer}
                        audioDelay={settingsHook.settings.audioDelay}
                        onLoad={player.handleLoad}
                        onProgress={player.handleProgress}
                        onEnd={handleVideoEnd}
                        onError={player.handleError}
                        onBuffering={player.handleBuffering}
                        onPlaying={player.handlePlaying}
                        onPaused={player.handlePaused}
                        onStopped={player.handleStopped}
                        onSeek={player.handleSeek}
                    />
                </View>
            </GestureDetector>



            {/* Floating Sync Panel */}
            {syncPanelType && (
                <FloatingSyncPanel
                    type={syncPanelType}
                    value={syncPanelType === 'audio' ? settingsHook.settings.audioDelay : settingsHook.settings.subtitleDelay}
                    onChange={syncPanelType === 'audio' ? settingsHook.setAudioDelay : settingsHook.setSubtitleDelay}
                    onClose={() => setSyncPanelType(null)}
                    subtitleCues={tracksHook.subtitleCues}
                    currentTime={player.currentTimeRef.current}
                    videoPath={videoPath}
                    subtitleLanguage={tracksHook.subtitleTracks.find(t => t.index === tracksHook.selectedSubtitleTrackIndex)?.language}
                />
            )}

            {/* Status Bar for Edge-to-Edge */}
            <SystemBars style="light" />

            {/* Night Mode Overlay - Sits between video and controls/HUD */}
            {nightMode && (
                <View
                    style={[
                        StyleSheet.absoluteFill,
                        { backgroundColor: 'black', opacity: 0.5, zIndex: 1 },
                    ]}
                    pointerEvents="none"
                />
            )}

            {/* HUD indicators */}
            {!isInPipMode && (
                <VideoHUD
                    showSeekHUD={hud.state.seek.show}
                    seekHUDTime={gestures.sharedValues.seekTime}
                    seekStartTime={hud.state.seek.startTime}
                    seekDirection={hud.state.seek.direction}
                    seekSide={hud.state.seek.side}
                    showBrightnessHUD={hud.state.brightness.show}
                    brightnessHUD={gestures.sharedValues.currentBrightness}
                    showVolumeHUD={hud.state.volume.show}
                    volumeHUD={gestures.sharedValues.currentVolume}
                    showSpeedHUD={hud.state.speed.show}
                    playbackRate={effectivePlaybackRate}
                    zoomActive={gestures.sharedValues.zoomActive.value}
                    zoomHUDScale={hud.state.zoom.scale}
                    shouldShowBuffer={shouldShowBuffer}
                    formatTime={formatTime}
                    showRipple={hud.state.ripple.show}
                    rippleX={hud.state.ripple.x}
                    rippleY={hud.state.ripple.y}
                    rippleSide={hud.state.ripple.side}
                    showResizeHUD={hud.state.resize.show}
                    resizeMode={hud.state.resize.mode}
                    maxVolume={gestures.maxVolume}
                />
            )}


            {/* Controls - hide in PIP mode */}
            {ui.state.controlsVisible && !ui.state.locked && !isInPipMode && (
                <PlayerControls
                    showControls={ui.state.controlsVisible && !ui.state.locked}
                    title={videoName}
                    onBack={handleGoBack}
                    onToggleAudio={handleToggleAudio}
                    onToggleSubtitle={handleToggleSubtitle}
                    onAddBookmark={isNetworkStream ? undefined : handleAddBookmark}
                    paused={player.state.paused || resumeModalVisible || recapVisible}
                    onTogglePlayPause={handleTogglePlayPause}
                    currentTime={player.currentTimeShared}
                    duration={player.durationShared}
                    seekPreviewTime={gestures.sharedValues.seekTime}
                    isScrubbingShared={player.isScrubbingShared}
                    onSeekStart={handleSlidingStart}
                    onSeek={handleSliderChange}
                    onSeekComplete={handleSliderChangeComplete}
                    errorText={player.state.errorText}
                    isLandscape={isLandscape}
                    insets={effectiveInsets}
                    audioTrackSelected={tracksHook.selectedAudioTrackId !== undefined}
                    subtitleTrackSelected={tracksHook.selectedSubtitleTrackIndex !== null}
                    formatTime={formatTime}
                    onToggleQuickSettings={handleToggleQuickSettings}
                    onToggleBookmarkPanel={isNetworkStream ? undefined : handleToggleBookmarkPanel}
                    onTogglePlaylist={isNetworkStream ? undefined : handleTogglePlaylist}
                    // New Props for Redesign
                    onNext={!isNetworkStream && hasNext ? handleNext : undefined}
                    onPrev={!isNetworkStream && hasPrevious ? handlePrevious : undefined}
                    onJumpBackward={handleJumpBackward}
                    onJumpForward={handleJumpForward}
                    onToggleLock={handleToggleOrientationLock}
                    isLocked={orientationLocked}
                    onToggleResizeMode={handleToggleResizeMode}
                    resizeMode={settingsHook.settings.resizeMode}
                    onToggleNightMode={toggleNightMode}
                    nightModeActive={nightMode}
                    playMode={playMode}
                    playbackRate={basePlaybackRate}
                    onToggleSpeed={handleToggleSpeed}
                    onToggleHaptics={handleToggleHaptics}
                    hapticsEnabled={hapticsEnabled}
                    onToggleBackgroundPlay={handleToggleBackgroundPlay}
                    backgroundPlayEnabled={settingsHook.settings.backgroundPlayEnabled}
                    onEnterPip={handleEnterPip}
                    videoEnhancement={settingsHook.settings.videoEnhancement}
                    onToggleVideoEnhancement={settingsHook.toggleVideoEnhancement}
                    showSeekButtons={settings.showSeekButtons}
                    seekDuration={settings.seekDuration}
                />
            )}

            {/* Lock button - hide in PIP mode */}
            {!isInPipMode && ((ui.state.controlsVisible && !ui.state.locked) || (ui.state.locked && ui.state.lockIconVisible)) ? (
                <LockButton
                    isLocked={ui.state.locked}
                    showLockIcon={true}
                    onToggleLock={ui.toggleLock}
                />
            ) : null}

            {/* Quick settings panel */}
            {ui.state.quickSettingsOpen && (
                <QuickSettingsPanel
                    onClose={handleQSClose}
                    playbackRate={basePlaybackRate}
                    onPlaybackRateChange={handlePlaybackRateChange}
                    muted={settingsHook.settings.muted}
                    onToggleMute={settingsHook.toggleMute}
                    repeat={settingsHook.settings.repeat}
                    onToggleRepeat={settingsHook.toggleRepeat}
                    sleepTimer={settingsHook.settings.sleepTimer}
                    onSetSleepTimer={settingsHook.setSleepTimer}
                    decoder={settingsHook.settings.decoder}
                    onSetDecoder={settingsHook.setDecoder}
                    onOpenPlaylist={isNetworkStream ? undefined : handleQSOpenPlaylist}
                    onOpenAudio={handleQSOpenAudio}
                    onOpenSubtitle={handleQSOpenSubtitle}
                    onOpenBookmarkPanel={isNetworkStream ? undefined : handleQSOpenBookmarkPanel}
                    onAddBookmark={isNetworkStream ? undefined : bookmarksHook.addBookmark}
                    resizeMode={settingsHook.settings.resizeMode}
                    onSetResizeMode={settingsHook.setResizeMode}
                    isLandscape={isLandscape}
                    insets={effectiveInsets}
                    enableHaptics={playMode === 'with-haptics'}
                    shakeEnabled={shakeEnabled}
                    onToggleShake={() => setShakeEnabled(prev => !prev)}
                    shakeAction={shakeAction}
                    onSelectShakeAction={setShakeAction}
                    seekDuration={settings.seekDuration}
                />
            )}

            {/* Playlist panel */}
            {!isNetworkStream && (
                <PlaylistPanel
                    visible={ui.state.playlistOpen}
                    onClose={() => ui.closePanel('playlist')}
                    currentVideoPath={videoPath}
                    onPlayVideo={handlePlayVideo}
                    isLandscape={isLandscape}
                    albumName={albumName ?? undefined}
                />
            )}

            {/* Track selectors */}
            <View style={styles.modalPortalWrapper} pointerEvents="box-none">
                {ui.state.audioSelectorOpen && (
                    <TrackSelector
                        visible={ui.state.audioSelectorOpen}
                        onClose={() => ui.closePanel('audioSelector')}
                        tracks={tracksHook.audioTracksForSelector}
                        selectedTrackIndex={tracksHook.selectedAudioTrackId}
                        onSelectTrack={tracksHook.selectAudioTrack}
                        type="audio"
                        equalizerEnabled={settingsHook.settings.equalizerEnabled}
                        equalizerPreset={settingsHook.settings.equalizerPreset}
                        onToggleEqualizer={settingsHook.toggleEqualizer}
                        onSelectPreset={settingsHook.setEqualizerPreset}
                        onOpenEqualizerModal={() => setEqualizerVisible(true)}
                        onOpenSyncPanel={(type) => {
                            setSyncPanelType(type);
                            ui.closeAllPanels();
                        }}
                    />
                )}
                {ui.state.subtitleSelectorOpen && (
                    <TrackSelector
                        visible={ui.state.subtitleSelectorOpen}
                        onClose={() => ui.closePanel('subtitleSelector')}
                        tracks={tracksHook.subtitleTracksForSelector}
                        selectedTrackIndex={tracksHook.selectedSubtitleTrackIndex}
                        onSelectTrack={tracksHook.selectSubtitleTrack}
                        type="subtitle"
                        onLoadExternalCues={tracksHook.loadExternalCues}
                        onLoadSDHForHaptics={tracksHook.loadSDHForHaptics}
                        externalSubtitles={tracksHook.externalSubtitles}
                        currentExternalName={tracksHook.currentExternalName || undefined}
                        videoName={videoName}
                        apiSubtitles={apiSubtitles}
                        imdbId={imdbId}
                        onOpenSyncPanel={(type) => {
                            setSyncPanelType(type);
                            ui.closeAllPanels();
                        }}
                    />
                )}
            </View>

            {/* Equalizer modal - rendered LAST so it appears on top of TrackSelector */}
            <View style={styles.modalPortalWrapper} pointerEvents="box-none">
                <EqualizerModal
                    visible={equalizerVisible}
                    onClose={() => setEqualizerVisible(false)}
                    activePresetId={settingsHook.settings.equalizerPreset}
                    customBands={settingsHook.settings.customEqualizerBands}
                    onSelectPreset={settingsHook.setEqualizerPreset}
                    onSetBandValue={settingsHook.setSingleBand}
                    onReset={() => {
                        settingsHook.setEqualizerPreset('flat');
                        settingsHook.setCustomEqualizerBands([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
                    }}
                    enabled={settingsHook.settings.equalizerEnabled}
                    onToggleEnabled={settingsHook.toggleEqualizer}
                />
            </View>

            {/* Subtitle overlay */}
            <SubtitleOverlay
                currentCue={tracksHook.currentSubtitleCue}
                settings={subtitleSettings}
            />

            {/* Bookmark toast */}
            {
                !isNetworkStream && bookmarksHook.showToast && !isInPipMode && (
                    <BookmarkToast
                        key={bookmarksHook.toastKey}
                        visible={bookmarksHook.showToast}
                        message={bookmarksHook.toastMessage}
                        duration={PLAYER_CONSTANTS.BOOKMARK_TOAST_DURATION_MS}
                        onHide={bookmarksHook.hideToast}
                        icon={bookmarksHook.toastIcon}
                    />
                )
            }

            {/* Bookmark panel */}
            {!isNetworkStream && (
                <BookmarkPanel
                    visible={ui.state.bookmarkPanelOpen}
                    bookmarks={bookmarksHook.bookmarks}
                    currentTime={player.state.currentTime}
                    onClose={() => ui.closePanel('bookmarkPanel')}
                    onSelectBookmark={bookmarksHook.jumpToBookmark}
                    onDeleteBookmark={bookmarksHook.deleteBookmark}
                    formatTime={formatTime}
                />
            )}

            {/* AI Recap Modal */}
            {!isNetworkStream && (
                <View style={styles.modalPortalWrapper} pointerEvents="box-none">
                    <RecapModal
                        visible={recapVisible}
                        onClose={() => {
                            setRecapVisible(false);
                            setIsGeneratingRecap(false);
                            setRecapLoadingMessage(undefined);
                            player.play(); // Resume video playback
                        }}
                        recapText={recapText}
                        videoName={cleanTitle || albumName || videoName}
                        isLoading={isGeneratingRecap}
                        loadingMessage={recapLoadingMessage}
                    />
                </View>
            )}

            {/* Resume Modal */}
            {!isNetworkStream && (
                <View style={styles.modalPortalWrapper} pointerEvents="box-none">
                    <ResumeModal
                        visible={resumeModalVisible}
                        videoName={videoName}
                        resumeTime={resumePosition || 0}
                        formattedResumeTime={resumeModalData?.formattedTime || ''}
                        remainingTime={resumeModalData?.remainingTime}
                        finishByTime={resumeModalData?.finishByTime}
                        showRecapOption={!!resumeModalData?.showRecap}
                        isGeneratingRecap={isGeneratingRecap}
                        onResume={() => handleResumeModalAction('resume')}
                        onRestart={() => handleResumeModalAction('restart')}
                        onRecap={() => handleResumeModalAction('recap')}
                        onClose={() => setResumeModalVisible(false)}
                    />
                </View>
            )}
        </View >
    );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    modalPortalWrapper: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        elevation: 10,
    },
});



