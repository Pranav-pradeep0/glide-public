/**
 * usePlayerUI Hook
 * 
 * Manages all UI visibility states for the video player:
 * - Controls visibility with auto-hide timer
 * - Lock mode state
 * - Panel states (only one panel open at a time)
 */

import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { VideoOrientationService } from '@/services/VideoOrientationService';
import {
    UIState,
    PanelType,
    UsePlayerUIReturn,
    PLAYER_CONSTANTS,
} from './types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialUIState: UIState = {
    controlsVisible: true,
    locked: false,
    lockIconVisible: false,
    quickSettingsOpen: false,
    bookmarkPanelOpen: false,
    playlistOpen: false,
    audioSelectorOpen: false,
    subtitleSelectorOpen: false,
};

// Panel type to state key mapping
const panelStateKeys: Record<PanelType, keyof UIState> = {
    quickSettings: 'quickSettingsOpen',
    bookmarkPanel: 'bookmarkPanelOpen',
    playlist: 'playlistOpen',
    audioSelector: 'audioSelectorOpen',
    subtitleSelector: 'subtitleSelectorOpen',
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing video player UI visibility states.
 * 
 * Key features:
 * - Controls auto-hide after inactivity
 * - Lock mode prevents touch interactions
 * - Panel orchestration ensures only one panel is open at a time
 * - Shared value for worklet access to lock state
 */
export function usePlayerUI(): UsePlayerUIReturn {
    const [state, setState] = useState<UIState>(initialUIState);

    // Shared value for gestures to check lock state in worklets
    const isLockedShared = useSharedValue(false);

    // Timer refs to avoid re-renders
    const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lockIconTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastInteractionTimeRef = useRef<number>(0);

    // ========================================================================
    // SYNC LOCK STATE TO SHARED VALUE
    // ========================================================================

    useEffect(() => {
        isLockedShared.value = state.locked;
    }, [state.locked, isLockedShared]);

    // ========================================================================
    // CLEANUP ON UNMOUNT
    // ========================================================================

    useEffect(() => {
        return () => {
            if (autoHideTimerRef.current) {
                clearTimeout(autoHideTimerRef.current);
            }
            if (lockIconTimerRef.current) {
                clearTimeout(lockIconTimerRef.current);
            }
        };
    }, []);

    // ========================================================================
    // INITIAL AUTO-HIDE ON MOUNT
    // ========================================================================

    useEffect(() => {
        // Controls start visible, schedule initial auto-hide
        autoHideTimerRef.current = setTimeout(() => {
            setState(s => {
                if (s.quickSettingsOpen || s.bookmarkPanelOpen ||
                    s.playlistOpen || s.audioSelectorOpen ||
                    s.subtitleSelectorOpen) {
                    return s;
                }
                return {
                    ...s,
                    controlsVisible: false,
                    quickSettingsOpen: false,
                };
            });
        }, PLAYER_CONSTANTS.CONTROLS_AUTO_HIDE_MS);
    }, []); // Run only on mount


    // ========================================================================
    // CONTROLS VISIBILITY
    // ========================================================================

    const showControls = useCallback(() => {
        lastInteractionTimeRef.current = Date.now();

        // Clear existing timer first
        if (autoHideTimerRef.current) {
            clearTimeout(autoHideTimerRef.current);
        }

        setState(prev => ({
            ...prev,
            controlsVisible: true,
        }));

        // Schedule auto-hide
        autoHideTimerRef.current = setTimeout(() => {
            setState(s => {
                // Don't hide if any panel is open
                if (s.quickSettingsOpen || s.bookmarkPanelOpen ||
                    s.playlistOpen || s.audioSelectorOpen ||
                    s.subtitleSelectorOpen) {
                    return s;
                }
                return {
                    ...s,
                    controlsVisible: false,
                    quickSettingsOpen: false,
                };
            });
        }, PLAYER_CONSTANTS.CONTROLS_AUTO_HIDE_MS);
    }, []);

    const hideControls = useCallback(() => {
        setState(prev => ({
            ...prev,
            controlsVisible: false,
            // Also close quick settings when hiding controls
            quickSettingsOpen: false,
        }));
    }, []);

    const toggleControls = useCallback(() => {
        // If there was a very recent interaction (e.g. button click), 
        // ignore this toggle intent (likely from background tap gesture)
        const now = Date.now();
        if (now - lastInteractionTimeRef.current < 300) {
            if (__DEV__) console.log('[usePlayerUI] Ignoring toggleControls due to recent interaction');
            return;
        }

        setState(prev => {
            const newVisible = !prev.controlsVisible;

            // Schedule auto-hide when showing controls
            if (newVisible) {
                // Clear existing timer first
                if (autoHideTimerRef.current) {
                    clearTimeout(autoHideTimerRef.current);
                }
                // Schedule new hide
                autoHideTimerRef.current = setTimeout(() => {
                    setState(s => {
                        // Don't hide if any panel is open
                        if (s.quickSettingsOpen || s.bookmarkPanelOpen ||
                            s.playlistOpen || s.audioSelectorOpen ||
                            s.subtitleSelectorOpen) {
                            return s;
                        }
                        return {
                            ...s,
                            controlsVisible: false,
                            quickSettingsOpen: false,
                        };
                    });
                }, PLAYER_CONSTANTS.CONTROLS_AUTO_HIDE_MS);
            }

            return {
                ...prev,
                controlsVisible: newVisible,
                // Close quick settings when hiding controls
                quickSettingsOpen: newVisible ? prev.quickSettingsOpen : false,
            };
        });
    }, []);

    /**
     * Schedule auto-hide of controls after inactivity.
     * This should be called after user interactions.
     */
    const scheduleAutoHide = useCallback(() => {
        lastInteractionTimeRef.current = Date.now();

        // Clear existing timer
        if (autoHideTimerRef.current) {
            clearTimeout(autoHideTimerRef.current);
        }

        // Schedule new hide - check panel state at hide time using setState callback
        // This avoids stale closure issues by always checking fresh state
        autoHideTimerRef.current = setTimeout(() => {
            setState(prev => {
                // Don't hide if any panel is open
                if (prev.quickSettingsOpen || prev.bookmarkPanelOpen ||
                    prev.playlistOpen || prev.audioSelectorOpen ||
                    prev.subtitleSelectorOpen) {
                    return prev;
                }
                return {
                    ...prev,
                    controlsVisible: false,
                    quickSettingsOpen: false,
                };
            });
        }, PLAYER_CONSTANTS.CONTROLS_AUTO_HIDE_MS);
    }, []); // No dependencies needed - uses setState callback for fresh state

    const cancelAutoHide = useCallback(() => {
        if (autoHideTimerRef.current) {
            clearTimeout(autoHideTimerRef.current);
            autoHideTimerRef.current = null;
        }
    }, []);

    // ========================================================================
    // LOCK MODE
    // ========================================================================

    const lock = useCallback(() => {
        VideoOrientationService.disableAuto();
        setState(prev => ({
            ...prev,
            locked: true,
            controlsVisible: false,
            lockIconVisible: false,
            // Close all panels when locking
            quickSettingsOpen: false,
            bookmarkPanelOpen: false,
            playlistOpen: false,
            audioSelectorOpen: false,
            subtitleSelectorOpen: false,
        }));
        if (__DEV__) console.log('[usePlayerUI] Controls and orientation locked');
    }, []);

    const unlock = useCallback(() => {
        VideoOrientationService.enableAuto();
        setState(prev => ({
            ...prev,
            locked: false,
            lockIconVisible: false,
            controlsVisible: true,
        }));
        if (__DEV__) console.log('[usePlayerUI] Controls and orientation unlocked');
    }, []);

    const toggleLock = useCallback(() => {
        if (state.locked) {
            unlock();
            // Schedule auto-hide after unlocking
            setTimeout(() => {
                scheduleAutoHide();
            }, 0);
        } else {
            lock();
        }
    }, [state.locked, lock, unlock, scheduleAutoHide]);

    /**
     * Show the lock icon temporarily when tapping in locked mode.
     * This provides feedback that the screen is locked.
     */
    const showLockIconTemporarily = useCallback(() => {
        if (!state.locked) return;

        setState(prev => ({
            ...prev,
            lockIconVisible: true,
        }));

        // Clear existing timer
        if (lockIconTimerRef.current) {
            clearTimeout(lockIconTimerRef.current);
        }

        // Hide after 2 seconds
        lockIconTimerRef.current = setTimeout(() => {
            setState(prev => ({
                ...prev,
                lockIconVisible: false,
            }));
        }, 2000);
    }, [state.locked]);

    // ========================================================================
    // PANEL MANAGEMENT
    // ========================================================================

    /**
     * Open a panel, closing any other open panels first.
     * Only one panel can be open at a time.
     */
    const openPanel = useCallback((panel: PanelType) => {
        lastInteractionTimeRef.current = Date.now();
        // Clear auto-hide timer when opening a panel
        if (autoHideTimerRef.current) {
            clearTimeout(autoHideTimerRef.current);
            autoHideTimerRef.current = null;
        }

        setState(prev => {
            // Close all panels first
            const closedState: UIState = {
                ...prev,
                quickSettingsOpen: false,
                bookmarkPanelOpen: false,
                playlistOpen: false,
                audioSelectorOpen: false,
                subtitleSelectorOpen: false,
            };

            // Open the requested panel
            const stateKey = panelStateKeys[panel];
            return {
                ...closedState,
                [stateKey]: true,
            };
        });

        if (__DEV__) console.log('[usePlayerUI] Panel opened:', panel);
    }, []);

    const closePanel = useCallback((panel: PanelType) => {
        lastInteractionTimeRef.current = Date.now();
        const stateKey = panelStateKeys[panel];
        setState(prev => ({
            ...prev,
            [stateKey]: false,
        }));

        // Resume auto-hide after closing panel if controls are visible
        if (state.controlsVisible) {
            scheduleAutoHide();
        }

        if (__DEV__) console.log('[usePlayerUI] Panel closed:', panel);
    }, [state.controlsVisible, scheduleAutoHide]);

    const closeAllPanels = useCallback(() => {
        setState(prev => ({
            ...prev,
            quickSettingsOpen: false,
            bookmarkPanelOpen: false,
            playlistOpen: false,
            audioSelectorOpen: false,
            subtitleSelectorOpen: false,
        }));

        // Resume auto-hide after closing all panels
        if (state.controlsVisible) {
            scheduleAutoHide();
        }

        if (__DEV__) console.log('[usePlayerUI] All panels closed');
    }, [state.controlsVisible, scheduleAutoHide]);

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        state,
        isLockedShared,

        // Controls
        toggleControls,
        showControls,
        hideControls,
        scheduleAutoHide,
        cancelAutoHide,

        // Lock
        lock,
        unlock,
        toggleLock,
        showLockIconTemporarily,

        // Panels
        openPanel,
        closePanel,
        closeAllPanels,
    }), [
        state, isLockedShared,
        toggleControls, showControls, hideControls, scheduleAutoHide, cancelAutoHide,
        lock, unlock, toggleLock, showLockIconTemporarily,
        openPanel, closePanel, closeAllPanels
    ]);
}

export default usePlayerUI;
