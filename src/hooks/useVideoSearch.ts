import { useState, useEffect, useMemo, useCallback } from 'react';
import { useVideoIndexStore } from '@/store/videoIndexStore';
import { VideoFile } from '@/types';

interface UseVideoSearchResult {
    query: string;
    setQuery: (query: string) => void;
    results: VideoFile[];
    isIndexReady: boolean;
    isIndexing: boolean;
    indexProgress: { scanned: number; total: number } | null;
    clearSearch: () => void;
    forceRefresh: () => Promise<void>;
}

/**
 * Hook for searching videos with debouncing.
 * Uses the video index store for instant in-memory search.
 * 
 * @param debounceMs - Debounce delay in milliseconds (default: 300)
 */
export function useVideoSearch(debounceMs = 300): UseVideoSearchResult {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');

    const {
        searchVideos,
        isIndexReady,
        isIndexing,
        indexProgress,
        forceFullSync,
    } = useVideoIndexStore();

    // Debounce the query
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(query);
        }, debounceMs);

        return () => clearTimeout(timer);
    }, [query, debounceMs]);

    // Search results (instant once index is ready)
    const results = useMemo(() => {
        if (!isIndexReady || !debouncedQuery.trim()) {
            return [];
        }
        return searchVideos(debouncedQuery);
    }, [debouncedQuery, isIndexReady, searchVideos]);

    const clearSearch = useCallback(() => {
        setQuery('');
        setDebouncedQuery('');
    }, []);

    const forceRefresh = useCallback(async () => {
        await forceFullSync();
    }, [forceFullSync]);

    return {
        query,
        setQuery,
        results,
        isIndexReady,
        isIndexing,
        indexProgress,
        clearSearch,
        forceRefresh,
    };
}
