/**
 * PipModule — Picture-in-Picture state, reported from native.
 *
 * PiP is owned by the native video view, which is the only place that knows the
 * video's real dimensions, the surface bounds in pixels and whether playback is
 * live. JS does not configure PiP: it says whether PiP is currently allowed (the
 * `pipEnabled` prop on the player) and reacts to the mode change reported here.
 *
 * To enter PiP, call `enterPictureInPicture()` on the player ref.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { useEffect, useState } from 'react';

const { PipModule: NativePipModule } = NativeModules;

const PIP_MODE_CHANGED_EVENT = 'onPipModeChanged';

interface PipModeEvent {
    isInPipMode: boolean;
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
 * Close the Activity hosting the player. Used for externally opened videos, where
 * dismissing the player should close this Activity rather than exit the app.
 */
export async function finishCurrentActivity(): Promise<boolean> {
    if (Platform.OS !== 'android' || !NativePipModule) {
        return false;
    }

    try {
        return await NativePipModule.finishCurrentActivity();
    } catch (error) {
        console.error('[PipModule] Failed to finish activity:', error);
        return false;
    }
}

/**
 * Hook to listen for PIP mode changes.
 * The native callback is authoritative, so there is nothing to poll.
 */
export function usePipModeListener(): boolean {
    const [isInPip, setIsInPip] = useState(false);

    useEffect(() => {
        if (Platform.OS !== 'android' || !NativePipModule) {
            return;
        }

        const eventEmitter = new NativeEventEmitter(NativePipModule);
        const subscription = eventEmitter.addListener(
            PIP_MODE_CHANGED_EVENT,
            (event: PipModeEvent) => setIsInPip(event.isInPipMode)
        );

        // Cover the case where the screen mounts while already in PiP.
        let cancelled = false;
        isInPipMode().then((inPip) => {
            if (!cancelled) {
                setIsInPip(inPip);
            }
        });

        return () => {
            cancelled = true;
            subscription.remove();
        };
    }, []);

    return isInPip;
}

export default {
    isInPipMode,
    isPipSupported,
    finishCurrentActivity,
    usePipModeListener,
};
