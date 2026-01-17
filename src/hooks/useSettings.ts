// src/hooks/useSettings.ts

import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { useAppStore } from '../store/appStore';
import { storage } from '@/storage/storage';

export function useSettings() {
    const { settings, updateSettings } = useAppStore();
    const systemColorScheme = useColorScheme();

    // Load settings on mount
    useEffect(() => {
        loadSettings();
    }, []);

    // Save settings whenever they change
    useEffect(() => {
        storage.saveSettings(settings);
    }, [settings]);

    async function loadSettings() {
        const saved = await storage.loadSettings();
        if (saved) {
            // If saved settings exist but darkMode is not set, initialize it from system preference
            if (saved.darkMode === undefined || saved.darkMode === null) {
                updateSettings({ ...saved, darkMode: systemColorScheme === 'dark' });
            } else {
                updateSettings(saved);
            }
        } else {
            // First time loading - initialize darkMode based on system preference
            updateSettings({ darkMode: systemColorScheme === 'dark' });
        }
    }

    return { settings, updateSettings };
}
