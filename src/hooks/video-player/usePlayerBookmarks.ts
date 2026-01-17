/**
 * usePlayerBookmarks Hook
 * 
 * Manages video bookmarks using the videoHistoryStore.
 * Handles adding, deleting, and jumping to bookmarks,
 * as well as toast notifications.
 */

import { useCallback, useState, useMemo } from 'react';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { useShallow } from 'zustand/shallow';
import { UsePlayerBookmarksReturn, PLAYER_CONSTANTS, formatTime } from './types';

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
    const [toastIcon, setToastIcon] = useState('bookmark');
    const [toastKey, setToastKey] = useState(0);

    // ========================================================================
    // TOAST HELPERS
    // ========================================================================

    const showToastWithMessage = useCallback((message: string, icon: string = 'bookmark') => {
        setToastMessage(message);
        setToastIcon(icon);
        setShowToast(true);
        setToastKey(prev => prev + 1);
    }, []);

    const hideToast = useCallback(() => {
        setShowToast(false);
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
                console.log('[usePlayerBookmarks] Cannot add bookmark - missing data');
            }
            return;
        }

        // Get current time from ref for accuracy
        const bookmarkTime = currentTimeRef.current;

        storeAddBookmark(videoPath, videoName, bookmarkTime);

        const timeStr = formatTime(bookmarkTime);
        showToastWithMessage(`Bookmark added at ${timeStr}`);

        if (__DEV__) {
            console.log('[usePlayerBookmarks] Bookmark added at', bookmarkTime);
        }
    }, [videoPath, videoName, duration, currentTimeRef, storeAddBookmark, showToastWithMessage]);

    /**
     * Delete a bookmark by ID.
     */
    const deleteBookmark = useCallback((bookmarkId: string) => {
        storeRemoveBookmark(videoPath, bookmarkId);
        showToastWithMessage('Bookmark deleted');

        if (__DEV__) {
            console.log('[usePlayerBookmarks] Bookmark deleted:', bookmarkId);
        }
    }, [videoPath, storeRemoveBookmark, showToastWithMessage]);

    /**
     * Jump to a bookmark timestamp.
     */
    const jumpToBookmark = useCallback((timestamp: number) => {
        onSeekToBookmark(timestamp);

        if (__DEV__) {
            console.log('[usePlayerBookmarks] Jumped to bookmark at', timestamp);
        }
    }, [onSeekToBookmark]);

    // ========================================================================
    // RETURN
    // ========================================================================

    return useMemo(() => ({
        bookmarks,
        showToast,
        toastMessage,
        toastIcon,
        toastKey,

        addBookmark,
        deleteBookmark,
        jumpToBookmark,
        hideToast,
        showToastWithMessage,
    }), [
        bookmarks,
        showToast, toastMessage, toastIcon, toastKey,
        addBookmark, deleteBookmark, jumpToBookmark,
        hideToast, showToastWithMessage
    ]);
}

export default usePlayerBookmarks;
