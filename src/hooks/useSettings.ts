// src/hooks/useSettings.ts

import { useCallback, useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';
import { useAppStore } from '../store/appStore';
import { storage } from '@/storage/storage';
import { AppSettings } from '@/types';

export function useSettings() {
    const { settings, updateSettings } = useAppStore();
    const systemColorScheme = useColorScheme();
    const hasLoadedSettingsRef = useRef(false);

    const loadSettings = useCallback(async () => {
        const saved = await storage.loadSettings();
        if (saved) {
            const migratedSettings = migrateSettings(saved);
            // If saved settings exist but darkMode is not set, initialize it from system preference
            if (migratedSettings.darkMode === undefined || migratedSettings.darkMode === null) {
                updateSettings({ ...migratedSettings, darkMode: systemColorScheme === 'dark' });
            } else {
                updateSettings(migratedSettings);
            }
        } else {
            // First time loading - initialize darkMode based on system preference
            updateSettings({ darkMode: systemColorScheme === 'dark' });
        }
        hasLoadedSettingsRef.current = true;
    }, [systemColorScheme, updateSettings]);

    // Load settings on mount
    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    // Save settings whenever they change
    useEffect(() => {
        if (!hasLoadedSettingsRef.current) {
            return;
        }
        storage.saveSettings(settings);
    }, [settings]);

    return { settings, updateSettings };
}

function migrateSettings(settings: AppSettings): AppSettings {
    return {
        ...settings,
        subtitlePositionPortrait: typeof settings.subtitlePositionPortrait === 'number'
            ? settings.subtitlePositionPortrait
            : 0.42,
        subtitlePositionLandscape: typeof settings.subtitlePositionLandscape === 'number'
            ? settings.subtitlePositionLandscape
            : 0.42,
    };
}
