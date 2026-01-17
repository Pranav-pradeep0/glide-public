/**
 * useAudioEqualizer Hook
 * 
 * Manages audio equalizer state including presets, custom bands, and enabled status.
 */

import { useState, useCallback, useMemo } from 'react';
import { EQUALIZER_PRESETS } from '@/config/equalizerPresets';

export interface EqualizerState {
    enabled: boolean;
    activePresetId: string; // 'flat', 'custom', or preset ID
    customBands: number[]; // 10 bands, -20 to 20
}

export interface UseAudioEqualizerReturn {
    // State
    enabled: boolean;
    activePresetId: string;
    customBands: number[];

    // Computed
    effectiveBands: number[] | undefined; // Passed to VLC player

    // Actions
    toggleEqualizer: () => void;
    selectPreset: (presetId: string) => void;
    setBandValue: (index: number, value: number) => void;
    resetToFlat: () => void;
}

const DEFAULT_BANDS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export function useAudioEqualizer(): UseAudioEqualizerReturn {
    const [enabled, setEnabled] = useState(false);
    const [activePresetId, setActivePresetId] = useState('flat');
    const [customBands, setCustomBands] = useState<number[]>([...DEFAULT_BANDS]);

    // Compute effective bands for the player
    // If disabled, return undefined (let player handle it or send null/empty)
    // If enabled, return the bands based on current preset or custom values
    const effectiveBands = useMemo(() => {
        if (!enabled) return undefined;

        if (activePresetId === 'custom') {
            return customBands;
        }

        const preset = EQUALIZER_PRESETS.find(p => p.id === activePresetId);
        return preset ? preset.values : DEFAULT_BANDS;
    }, [enabled, activePresetId, customBands]);

    const toggleEqualizer = useCallback(() => {
        setEnabled(prev => !prev);
    }, []);

    const selectPreset = useCallback((presetId: string) => {
        setActivePresetId(presetId);

        // If selecting 'custom', leave bands as is (restoring previous custom state)
        // If selecting a preset, enable the equalizer if disabled
        if (presetId !== 'flat') {
            setEnabled(true);
        }

        // If selecting a real preset, we might want to sync customBands to it 
        // so if they start editing, they start from that preset
        if (presetId !== 'custom') {
            const preset = EQUALIZER_PRESETS.find(p => p.id === presetId);
            if (preset) {
                setCustomBands([...preset.values]);
            }
        }
    }, []);

    const setBandValue = useCallback((index: number, value: number) => {
        setCustomBands(prev => {
            const newBands = [...prev];
            newBands[index] = value;
            return newBands;
        });

        // Automatically switch to custom mode when adjusting bands manually
        if (activePresetId !== 'custom') {
            setActivePresetId('custom');
        }

        // Auto-enable if disabled
        if (!enabled) {
            setEnabled(true);
        }
    }, [enabled, activePresetId]);

    const resetToFlat = useCallback(() => {
        setCustomBands([...DEFAULT_BANDS]);
        setActivePresetId('flat');
        // Optional: disable or keep enabled
    }, []);

    return {
        enabled,
        activePresetId,
        customBands,
        effectiveBands,
        toggleEqualizer,
        selectPreset,
        setBandValue,
        resetToFlat,
    };
}
