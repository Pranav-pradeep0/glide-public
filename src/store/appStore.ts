import { create } from 'zustand';
import { AppSettings, HapticSettings } from '../types';

// Default haptic settings
const DEFAULT_HAPTIC_SETTINGS: HapticSettings = {
    enabled: true,
    intensity: 128, // Middle value (1-255)
};

interface AppStore {
    settings: AppSettings;
    updateStatus: {
        available: boolean;
        latestVersion: string | null;
        releaseUrl: string | null;
        releaseNotes: string | null;
        apkUrl: string | null;
        lastCheckedAt: number | null;
        seen: boolean;
        notified: boolean;
    };
    updateSettings: (settings: Partial<AppSettings>) => void;
    toggleDarkMode: () => void;
    toggleHaptics: () => void;
    toggleAutoDownloadSubtitles: () => void;
    setSubtitleFontSize: (size: number) => void;
    setSubtitleColor: (color: string) => void;
    setSubtitleFontWeight: (weight: number) => void;
    setSubtitleOutlineWidth: (width: number) => void;
    setSubtitleBackgroundColor: (color: string) => void;
    setSubtitleBackgroundOpacity: (opacity: number) => void;
    setSubtitleEdgeStyle: (style: 'none' | 'outline' | 'dropShadow') => void;
    setSubtitleFontFamily: (fontFamily: string) => void;
    resetSubtitleSettings: () => void;
    completeOnboarding: () => void;
    setHapticIntensity: (intensity: number) => void;
    resetHapticSettings: () => void;

    // Brightness settings
    setBrightnessMode: (mode: 'global' | 'video') => void;
    setPipBrightnessMode: (mode: 'system' | 'player') => void;
    setGlobalBrightness: (brightness: number) => void;

    // Playback settings
    setShowSeekButtons: (show: boolean) => void;
    setSeekDuration: (duration: number) => void;

    setAutoPlayNext: (enabled: boolean) => void;
    setDefaultAudioLanguage: (language: string | null) => void;
    setShakeThreshold: (threshold: number) => void;

    // Update actions
    setUpdateStatus: (data: {
        available: boolean;
        latestVersion: string | null;
        releaseUrl: string | null;
        releaseNotes: string | null;
        apkUrl: string | null;
    }) => void;
    markUpdateSeen: () => void;
    markUpdateNotified: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
    settings: {
        darkMode: false,
        hapticSettings: DEFAULT_HAPTIC_SETTINGS,
        autoDownloadSubtitles: true,
        subtitleFontSize: 20,
        subtitleColor: '#FFFFFF',
        subtitleFontWeight: 600,
        subtitleOutlineWidth: 2,
        subtitleBackgroundColor: 'transparent', // Default transparent
        subtitleBackgroundOpacity: 0.5,
        subtitleEdgeStyle: 'outline', // Default outline for legibility
        subtitleFontFamily: 'NetflixSans-Medium',

        hasCompletedOnboarding: false,
        brightnessMode: 'video', // Default to video-specific as per original request, or global? Let's stick to video as default for now or user preference. Detailed in plan: "video" default.
        pipBrightnessMode: 'system', // Default to system brightness for PiP
        globalBrightness: 0.5,

        // Playback settings
        showSeekButtons: false,
        seekDuration: 30,

        autoPlayNext: false,
        defaultAudioLanguage: null,
        shakeThreshold: 1.2,
    },
    updateStatus: {
        available: false,
        latestVersion: null,
        releaseUrl: null,
        releaseNotes: null,
        apkUrl: null,
        lastCheckedAt: null,
        seen: false,
        notified: false,
    },
    updateSettings: (newSettings) =>
        set((state) => ({
            settings: { ...state.settings, ...newSettings },
        })),
    toggleDarkMode: () =>
        set((state) => ({
            settings: { ...state.settings, darkMode: !state.settings.darkMode },
        })),
    toggleHaptics: () =>
        set((state) => ({
            settings: {
                ...state.settings,
                hapticSettings: {
                    ...state.settings.hapticSettings,
                    enabled: !state.settings.hapticSettings.enabled,
                },
            },
        })),
    toggleAutoDownloadSubtitles: () =>
        set((state) => ({
            settings: {
                ...state.settings,
                autoDownloadSubtitles: !state.settings.autoDownloadSubtitles,
            },
        })),
    setSubtitleFontSize: (size) =>
        set((state) => ({
            settings: { ...state.settings, subtitleFontSize: size },
        })),
    setSubtitleColor: (color) =>
        set((state) => ({
            settings: { ...state.settings, subtitleColor: color },
        })),
    setSubtitleFontWeight: (weight) =>
        set((state) => ({
            settings: { ...state.settings, subtitleFontWeight: weight },
        })),
    setSubtitleOutlineWidth: (width) =>
        set((state) => ({
            settings: { ...state.settings, subtitleOutlineWidth: width },
        })),
    setSubtitleBackgroundColor: (color) =>
        set((state) => ({
            settings: { ...state.settings, subtitleBackgroundColor: color },
        })),
    setSubtitleBackgroundOpacity: (opacity) =>
        set((state) => ({
            settings: { ...state.settings, subtitleBackgroundOpacity: opacity },
        })),
    setSubtitleEdgeStyle: (style) =>
        set((state) => ({
            settings: { ...state.settings, subtitleEdgeStyle: style },
        })),
    setSubtitleFontFamily: (fontFamily) =>
        set((state) => ({
            settings: { ...state.settings, subtitleFontFamily: fontFamily },
        })),
    resetSubtitleSettings: () =>
        set((state) => ({
            settings: {
                ...state.settings,
                subtitleFontSize: 20,
                subtitleColor: '#FFFFFF',
                subtitleFontWeight: 600,
                subtitleOutlineWidth: 2,
                subtitleBackgroundColor: 'transparent',
                subtitleBackgroundOpacity: 0.5,
                subtitleEdgeStyle: 'outline',
                subtitleFontFamily: 'NetflixSans-Medium',
            },
        })),
    completeOnboarding: () =>
        set((state) => ({
            settings: { ...state.settings, hasCompletedOnboarding: true },
        })),
    // Simplified haptic intensity setter
    setHapticIntensity: (intensity: number) =>
        set((state) => ({
            settings: {
                ...state.settings,
                hapticSettings: {
                    ...state.settings.hapticSettings,
                    intensity: Math.max(1, Math.min(255, intensity)),
                },
            },
        })),
    resetHapticSettings: () =>
        set((state) => ({
            settings: {
                ...state.settings,
                hapticSettings: DEFAULT_HAPTIC_SETTINGS,
            },
        })),

    // Brightness actions
    setBrightnessMode: (mode) =>
        set((state) => ({
            settings: { ...state.settings, brightnessMode: mode },
        })),
    setPipBrightnessMode: (mode) =>
        set((state) => ({
            settings: { ...state.settings, pipBrightnessMode: mode },
        })),
    setGlobalBrightness: (brightness) =>
        set((state) => ({
            settings: { ...state.settings, globalBrightness: brightness },
        })),

    // Playback settings
    setShowSeekButtons: (show) =>
        set((state) => ({
            settings: { ...state.settings, showSeekButtons: show },
        })),
    setSeekDuration: (duration) =>
        set((state) => ({
            settings: { ...state.settings, seekDuration: duration },
        })),
    setAutoPlayNext: (enabled) =>
        set((state) => ({
            settings: { ...state.settings, autoPlayNext: enabled },
        })),
    setDefaultAudioLanguage: (language) =>
        set((state) => ({
            settings: { ...state.settings, defaultAudioLanguage: language },
        })),
    setShakeThreshold: (threshold) =>
        set((state) => ({
            settings: { ...state.settings, shakeThreshold: threshold },
        })),

    setUpdateStatus: (data) =>
        set((state) => {
            const versionChanged = data.latestVersion && data.latestVersion !== state.updateStatus.latestVersion;
            return {
                updateStatus: {
                    ...state.updateStatus,
                    ...data,
                    lastCheckedAt: Date.now(),
                    seen: data.available ? false : state.updateStatus.seen,
                    notified: data.available ? (versionChanged ? false : state.updateStatus.notified) : false,
                },
            };
        }),
    markUpdateSeen: () =>
        set((state) => ({
            updateStatus: {
                ...state.updateStatus,
                seen: true,
            },
        })),
    markUpdateNotified: () =>
        set((state) => ({
            updateStatus: {
                ...state.updateStatus,
                notified: true,
            },
        })),
}));
