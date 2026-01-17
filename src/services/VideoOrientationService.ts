import { NativeModules } from 'react-native';

const { VideoOrientation } = NativeModules;

/**
 * Service to handle video player orientation independently of system settings.
 * Uses custom native module `VideoOrientation`.
 */
export const VideoOrientationService = {
    /**
     * Lock the screen to Portrait mode.
     */
    lockPortrait: () => {
        VideoOrientation.lockToPortrait();
    },

    /**
     * Lock the screen to Landscape mode.
     * Starts strictly as sensor landscape, but locks it.
     */
    lockLandscape: () => {
        VideoOrientation.lockToLandscape();
    },

    /**
     * Enable auto-orientation based on device sensor.
     * This OVERRIDES system auto-rotate settings.
     * The app will rotate even if system auto-rotate is OFF.
     */
    enableAuto: () => {
        VideoOrientation.enableAuto();
    },

    /**
     * Disable auto-orientation detection.
     * Keeps the current orientation locked.
     * Use this when HUD is locked.
     */
    disableAuto: () => {
        VideoOrientation.disableAuto();
    },

    /**
     * Release control and return to system default behavior.
     * Should be called when exiting the video player.
     */
    release: () => {
        VideoOrientation.release();
    }
};
