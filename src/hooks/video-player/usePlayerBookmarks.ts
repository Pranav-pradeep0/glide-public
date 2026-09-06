/**
 * usePlayerBookmarks Hook
 *
 * Manages video bookmarks using the videoHistoryStore.
 * Handles adding, deleting, and jumping to bookmarks,
 * as well as toast notifications.
 */

import { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { useShallow } from 'zustand/shallow';
import { UsePlayerBookmarksReturn, PLAYER_CONSTANTS, formatTime } from './types';

/** BookmarkToast's own auto-hide is 2000 ms; this only has to outlast it. */
const TOAST_FALLBACK_HIDE_MS = 2600;

// ============================================================================
// TYPES
// ============================================================================

interface UsePlayerBookmarksOptions {
    videoPath: string;
    videoName: string;
    duration: number;
    currentTimeRef: React.MutableRefObject<number>;
    onSeekToBookmark: (timestamp: number) => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing video bookmarks.
 *
 * Uses videoHistoryStore for persistence.
 * Provides toast notifications for user feedback.
 */
export function usePlayerBookmarks(options: UsePlayerBookmarksOptions): UsePlayerBookmarksReturn {
    const {
        videoPath,
        videoName,
        duration,
        currentTimeRef,
        onSeekToBookmark,
    } = options;

    // ========================================================================
    // STORE ACCESS
    // ========================================================================

    const bookmarks = useVideoHistoryStore(
        useShallow((state) => state.getVideoHistory(videoPath)?.bookmarks || [])
    );

    const storeAddBookmark = useVideoHistoryStore(state => state.addBookmark);
    const storeRemoveBookmark = useVideoHistoryStore(state => state.removeBookmark);

    // ========================================================================
    // TOAST STATE
    // ========================================================================

    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    const [toastKey, setToastKey] = useState(0);

    // ========================================================================
    // TOAST HELPERS
    // ========================================================================

    /**
     * The timeout lives here, not in BookmarkToast.
     *
     * BookmarkToast auto-hides itself after `duration` and reports it through `onHide`, but
     * the screen unmounts it whenever the player enters PiP. Unmounting cancels the
     * animation, so `onHide` never fires and `showToast` stays true forever — and the toast
     * replays on the next mount. That is why an "enabled" toast reappeared on returning to
     * the player from PiP or from the notification. Owning visibility means owning the
     * timeout that ends it.
     */
    const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

    const hideToast = useCallback(() => {
        if (toastTimerRef.current) {
            clearTimeout(toastTimerRef.current);
            toastTimerRef.current = null;
        }
        setShowToast(false);
    }, []);

    const showToastWithMessage = useCallback((message: string) => {
        setToastMessage(message);
        setShowToast(true);
        setToastKey(prev => prev + 1);

        if (toastTimerRef.current) {clearTimeout(toastTimerRef.current);}
        // Slightly longer than BookmarkToast's own 2000 ms so the component still owns the
        // exit animation in the normal case; this only catches the unmounted one.
        toastTimerRef.current = setTimeout(() => {
            toastTimerRef.current = null;
            setShowToast(false);
        }, TOAST_FALLBACK_HIDE_MS);
    }, []);

    useEffect(() => () => {
        if (toastTimerRef.current) {clearTimeout(toastTimerRef.current);}
    }, []);

    // ========================================================================
    // BOOKMARK ACTIONS
    // ========================================================================

    /**
     * Add a bookmark at the current playback position.
     */
    const addBookmark = useCallback(() => {
        if (!videoPath || !videoName || duration === 0) {
            if (__DEV__) {
                if (__DEV__) {console.log('[usePlayerBookmarks] Cannot add bookmark - missing data');}
            }
            return;
        }

        // Get current time from ref for accuracy
        const bookmarkTime = currentTimeRef.current;

        storeAddBookmark(videoPath, videoName, bookmarkTime);

        const timeStr = formatTime(bookmarkTime);
        showToastWithMessage(`Bookmark added at ${timeStr}`);

        if (__DEV__) {
            if (__DEV__) {console.log('[usePlayerBookmarks] Bookmark added at', bookmarkTime);}
        }
    }, [videoPath, videoName, duration, currentTimeRef, storeAddBookmark, showToastWithMessage]);

    /**
     * Delete a bookmark by ID.
     */
    const deleteBookmark = useCallback((bookmarkId: string) => {
        storeRemoveBookmark(videoPath, bookmarkId);
        showToastWithMessage('Bookmark deleted');

        if (__DEV__) {
            if (__DEV__) {console.log('[usePlayerBookmarks] Bookmark deleted:', bookmarkId);}
        }
    }, [videoPath, storeRemoveBookmark, showToastWithMessage]);

    /**
     * Jump to a bookmark timestamp.
     */
    const jumpToBookmark = useCallback((timestamp: number) => {
        onSeekToBookmark(timestamp);

        if (__DEV__) {
            if (__DEV__) {console.log('[usePlayerBookmarks] Jumped to bookmark at', timestamp);}
        }
    }, [onSeekToBookmark]);

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        bookmarks,
        showToast,
        toastMessage,
        toastKey,

        addBookmark,
        deleteBookmark,
        jumpToBookmark,
        hideToast,
        showToastWithMessage,
    }), [
        bookmarks,
        showToast, toastMessage, toastKey,
        addBookmark, deleteBookmark, jumpToBookmark,
        hideToast, showToastWithMessage,
    ]);
}

export default usePlayerBookmarks;


