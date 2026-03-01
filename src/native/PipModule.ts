/**
 * PipModule - TypeScript wrapper for native PIP functionality
 *
 * Provides:
 * - enterPipMode() - Enter Picture-in-Picture mode
 * - isInPipMode() - Check if currently in PIP mode
 * - isPipSupported() - Check if PIP is supported on this device
 * - usePipModeListener() - Hook for listening to PIP mode changes
 */

import { NativeModules, NativeEventEmitter, Platform, AppState, AppStateStatus } from 'react-native';
import { useEffect, useState, useRef, useCallback } from 'react';

const { PipModule: NativePipModule } = NativeModules;

// Event name for PIP mode changes
const PIP_MODE_CHANGED_EVENT = 'onPipModeChanged';

interface PipModeEvent {
    isInPipMode: boolean;
}

/**
 * Enter Picture-in-Picture mode
 * @param aspectRatioWidth Width component of aspect ratio (default: 16)
 * @param aspectRatioHeight Height component of aspect ratio (default: 9)
 * @returns Promise that resolves to true if PIP was entered successfully
 */
export async function enterPipMode(
    aspectRatioWidth: number = 16,
    aspectRatioHeight: number = 9
): Promise<boolean> {
    if (Platform.OS !== 'android' || !NativePipModule) {
        console.warn('[PipModule] PIP is only supported on Android');
        return false;
    }

    try {
        return await NativePipModule.enterPipMode(aspectRatioWidth, aspectRatioHeight);
    } catch (error) {
        console.error('[PipModule] Failed to enter PIP mode:', error);
        return false;
    }
}

/**
 * Check if the app is currently in PIP mode
 */
export async function isInPipMode(): Promise<boolean> {
    if (Platform.OS !== 'android' || !NativePipModule) {
        return false;
    }

    try {
        return await NativePipModule.isInPipMode();
    } catch (error) {
        console.error('[PipModule] Failed to check PIP mode:', error);
        return false;
    }
}

/**
 * Check if PIP is supported on this device
 */
export async function isPipSupported(): Promise<boolean> {
    if (Platform.OS !== 'android' || !NativePipModule) {
        return false;
    }

    try {
        return await NativePipModule.isPipSupported();
    } catch (error) {
        console.error('[PipModule] Failed to check PIP support:', error);
        return false;
    }
}

/**
 * Hook to listen for PIP mode changes
 * Uses both native events AND AppState polling for reliability
 * Returns true when in PIP mode, false otherwise
 */
export function usePipModeListener(): boolean {
    const [isInPip, setIsInPip] = useState(false);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    // Function to check PIP status
    const checkPipStatus = useCallback(async () => {
        if (Platform.OS !== 'android' || !NativePipModule) {
            return;
        }
        try {
            const inPip = await NativePipModule.isInPipMode();
            setIsInPip(inPip);
        } catch (e) {
            // Ignore errors
        }
    }, []);

    useEffect(() => {
        if (Platform.OS !== 'android' || !NativePipModule) {
            return;
        }

        // Listen for native PIP events
        const eventEmitter = new NativeEventEmitter(NativePipModule);
        const subscription = eventEmitter.addListener(
            PIP_MODE_CHANGED_EVENT,
            (event: PipModeEvent) => {
                setIsInPip(event.isInPipMode);
            }
        );

        // Also poll on app state changes (more reliable)
        const appStateSubscription = AppState.addEventListener('change', (nextState) => {
            // Check PIP status whenever app state changes
            checkPipStatus();
            appStateRef.current = nextState;
        });

        // Check initial PIP state
        checkPipStatus();

        // Poll less frequently - PIP mode changes don't need sub-second detection
        const interval = setInterval(checkPipStatus, 1000);

        return () => {
            subscription.remove();
            appStateSubscription.remove();
            clearInterval(interval);
        };
    }, [checkPipStatus]);

    return isInPip;
}

export default {
    enterPipMode,
    isInPipMode,
    isPipSupported,
    usePipModeListener,
};
