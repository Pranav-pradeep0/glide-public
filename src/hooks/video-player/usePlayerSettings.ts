/**
 * usePlayerSettings Hook
 * 
 * Manages player settings like mute, repeat, decoder, resize mode, and sleep timer.
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { PlayerResizeMode } from '@glide/vlc-player';
import { PlayerSettings, UsePlayerSettingsReturn } from './types';
import { EQUALIZER_PRESETS } from '@/config/equalizerPresets';

// ============================================================================
// TYPES
// ============================================================================

interface UsePlayerSettingsOptions {
    onDecoderChange?: () => void;
    onSleepTimerEnd?: () => void;
    showToast?: (message: string, icon?: string) => void;
    initialAudioDelay?: number;
    initialSubtitleDelay?: number;
}


// ============================================================================
// INITIAL STATE
// ============================================================================

const initialSettings: PlayerSettings = {
    muted: false,
    repeat: false,
    sleepTimer: null,
    decoder: 'hardware',
    resizeMode: 'contain',
    playerKey: 0,
    skipDuration: 30,
    backgroundPlayEnabled: false,
    videoEnhancement: false,

    // Equalizer defaults
    equalizerEnabled: false,
    equalizerPreset: 'flat',
    customEqualizerBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

    // Synchronization defaults
    audioDelay: 0,
    subtitleDelay: 0,

    // Subtitle defaults
    subtitleFontSize: 20,
    subtitleColor: '#FFFFFF',
    subtitleFontWeight: 600, // Semi-bold default
    subtitleOutlineWidth: 2, // Default outline width
    subtitleBackgroundColor: 'transparent',
    subtitleBackgroundOpacity: 0.5,
    subtitleEdgeStyle: 'outline',
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing player settings.
 * 
 * Settings include:
 * - Mute toggle
 * - Repeat mode
 * - Decoder selection (hardware, software, hardware+)
 * - Resize mode
 * - Sleep timer
 */
export function usePlayerSettings(options: UsePlayerSettingsOptions = {}): UsePlayerSettingsReturn {
    const {
        onDecoderChange,
        onSleepTimerEnd,
        showToast,
        initialAudioDelay = 0,
        initialSubtitleDelay = 0
    } = options;

    const [settings, setSettings] = useState<PlayerSettings>({
        ...initialSettings,
        audioDelay: initialAudioDelay,
        subtitleDelay: initialSubtitleDelay,
    });

    const sleepTimerRef = useRef<NodeJS.Timeout | null>(null);

    // ========================================================================
    // CLEANUP
    // ========================================================================

    useEffect(() => {
        return () => {
            if (sleepTimerRef.current) {
                clearTimeout(sleepTimerRef.current);
            }
        };
    }, []);

    // ========================================================================
    // MUTE
    // ========================================================================

    const toggleMute = useCallback(() => {
        setSettings(prev => ({
            ...prev,
            muted: !prev.muted,
        }));
    }, []);

    // ========================================================================
    // REPEAT
    // ========================================================================

    const toggleRepeat = useCallback(() => {
        setSettings(prev => ({
            ...prev,
            repeat: !prev.repeat,
        }));
    }, []);

    // ========================================================================
    // DECODER
    // ========================================================================

    const setDecoder = useCallback((decoder: 'hardware' | 'software' | 'hardware_plus') => {
        setSettings(prev => {
            if (prev.decoder === decoder) return prev;

            return {
                ...prev,
                decoder,
                playerKey: prev.playerKey + 1,
            };
        });

        // Notify about decoder change for toast
        const decoderName = decoder === 'hardware_plus' ? 'HW+' :
            decoder === 'hardware' ? 'HW' : 'SW';
        showToast?.(`Decoder switched to ${decoderName}`, 'cpu');

        // Call callback for any additional handling
        onDecoderChange?.();
    }, [showToast, onDecoderChange]);

    // ========================================================================
    // RESIZE MODE
    // ========================================================================

    const setResizeMode = useCallback((mode: PlayerResizeMode) => {
        setSettings(prev => ({
            ...prev,
            resizeMode: mode,
        }));
    }, []);

    const toggleResizeMode = useCallback(() => {
        setSettings(prev => {
            const modes = ['best-fit', 'contain', 'cover', 'fill', 'scale-down', 'none'] as PlayerResizeMode[];
            const nextIndex = (modes.indexOf(prev.resizeMode) + 1) % modes.length;
            return { ...prev, resizeMode: modes[nextIndex] };
        });
    }, []);

    // ========================================================================
    // SLEEP TIMER
    // ========================================================================

    const clearSleepTimer = useCallback(() => {
        if (sleepTimerRef.current) {
            clearTimeout(sleepTimerRef.current);
            sleepTimerRef.current = null;
        }
    }, []);

    const setSleepTimer = useCallback((minutes: number | null) => {
        // Clear existing timer
        clearSleepTimer();

        setSettings(prev => ({
            ...prev,
            sleepTimer: minutes,
        }));

        if (minutes !== null && minutes > 0) {
            // Set actual timer
            sleepTimerRef.current = setTimeout(() => {
                if (__DEV__) console.log('[usePlayerSettings] Sleep timer triggered');
                onSleepTimerEnd?.();
            }, minutes * 60 * 1000);

            showToast?.(`Sleep timer set for ${minutes} minutes`, 'clock');
        } else if (minutes === -1) {
            // End of video - handled in player's onEnd
            showToast?.('Sleep timer set for End of Video', 'clock');
        } else {
            showToast?.('Sleep timer disabled', 'clock');
        }
    }, [clearSleepTimer, onSleepTimerEnd, showToast]);

    // ========================================================================
    // BACKGROUND PLAY
    // ========================================================================

    const toggleBackgroundPlay = useCallback(() => {
        setSettings(prev => {
            const newValue = !prev.backgroundPlayEnabled;
            showToast?.(newValue ? 'Background play enabled' : 'Background play disabled', 'background-play');
            return {
                ...prev,
                backgroundPlayEnabled: newValue,
            };
        });
    }, [showToast]);

    // ========================================================================
    // VIDEO ENHANCEMENT
    // ========================================================================

    const toggleVideoEnhancement = useCallback(() => {
        setSettings(prev => {
            const newValue = !prev.videoEnhancement;
            const message = newValue
                ? 'Color Enhancement Enabled'
                : 'Color Enhancement Disabled';

            showToast?.(message, 'layers');

            return {
                ...prev,
                videoEnhancement: newValue,
                // playerKey: prev.playerKey + 1, // Force remount if needed, but maybe not for just video filter? 
                // Actually video filters often require restart or dynamic update. 
                // Let's keep existing behavior if it works.
                playerKey: prev.playerKey + 1,
            };
        });
    }, [showToast]);

    // ========================================================================
    // EQUALIZER
    // ========================================================================

    const toggleEqualizer = useCallback(() => {
        setSettings(prev => ({
            ...prev,
            equalizerEnabled: !prev.equalizerEnabled,
        }));
    }, []);

    const setEqualizerPreset = useCallback((presetId: string) => {
        // Workaround: Briefly disable equalizer to force native player to re-apply settings
        // This fixes an issue where switching presets might not update the audio immediately
        setSettings(prev => ({ ...prev, equalizerEnabled: false }));

        setTimeout(() => {
            setSettings(prev => {
                const preset = EQUALIZER_PRESETS.find(p => p.id === presetId);
                // If selecting a preset (not custom/flat), sync custom bands to it as a starting point
                let newCustomBands = prev.customEqualizerBands;
                if (preset && presetId !== 'custom' && presetId !== 'flat') {
                    newCustomBands = [...preset.values];
                }

                return {
                    ...prev,
                    equalizerPreset: presetId,
                    customEqualizerBands: newCustomBands,
                    equalizerEnabled: presetId !== 'flat' ? true : prev.equalizerEnabled,
                };
            });
        }, 50);
    }, []);

    const setCustomEqualizerBands = useCallback((bands: number[]) => {
        setSettings(prev => ({
            ...prev,
            customEqualizerBands: bands,
            equalizerPreset: 'custom',
            equalizerEnabled: true,
        }));
    }, []);

    const setSingleBand = useCallback((index: number, value: number) => {
        setSettings(prev => {
            const newBands = [...prev.customEqualizerBands];
            newBands[index] = value;
            return {
                ...prev,
                customEqualizerBands: newBands,
                equalizerPreset: 'custom',
                equalizerEnabled: true,
            };
        });
    }, []);

    // ========================================================================
    // SYNCHRONIZATION
    // ========================================================================

    const setAudioDelay = useCallback((delay: number) => {
        setSettings(prev => ({ ...prev, audioDelay: delay }));
    }, []);

    const setSubtitleDelay = useCallback((delay: number) => {
        setSettings(prev => ({ ...prev, subtitleDelay: delay }));
    }, []);

    // Compute effective bands for VLC
    const audioEqualizer = useMemo(() => {
        if (!settings.equalizerEnabled) return undefined;

        if (settings.equalizerPreset === 'custom') {
            return settings.customEqualizerBands;
        }

        const preset = EQUALIZER_PRESETS.find(p => p.id === settings.equalizerPreset);
        return preset ? preset.values : undefined;
    }, [settings.equalizerEnabled, settings.equalizerPreset, settings.customEqualizerBands]);

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        settings,
        toggleMute,
        toggleRepeat,
        setDecoder,
        setResizeMode,
        toggleResizeMode,
        setSleepTimer,
        clearSleepTimer,
        toggleBackgroundPlay,
        toggleVideoEnhancement,

        // Equalizer
        toggleEqualizer,
        setEqualizerPreset,
        setCustomEqualizerBands,
        setSingleBand,
        audioEqualizer,

        // Synchronization
        setAudioDelay,
        setSubtitleDelay,
    }), [
        settings,
        toggleMute, toggleRepeat,
        setDecoder, setResizeMode, toggleResizeMode,
        setSleepTimer, clearSleepTimer,
        toggleBackgroundPlay, toggleVideoEnhancement,
        toggleEqualizer, setEqualizerPreset, setCustomEqualizerBands, setSingleBand, audioEqualizer,
        setAudioDelay, setSubtitleDelay
    ]);
}

export default usePlayerSettings;

