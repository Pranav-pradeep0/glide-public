// src/services/SubtitleCacheService.ts
import * as RNFS from '@dr.pogodin/react-native-fs';
import { SubtitleResult } from '../types';

const LOG_PREFIX = '[SubtitleCache]';
const CACHE_DIR = `${RNFS.CachesDirectoryPath}/subtitles`;
const CACHE_INDEX_FILE = `${CACHE_DIR}/cache_index.json`;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

interface CachedSubtitleEntry {
    imdbId: string;
    fileName: string;
    fetchedAt: number;
    subtitles: SubtitleResult[];  // All available subtitles
    sdhSubtitleId?: string;       // Which one we're using for haptics
    downloadedPaths: Record<string, string>;  // subId -> local file path
}

export class SubtitleCacheService {
    private static cacheIndex: Record<string, CachedSubtitleEntry> = {};
    private static initialized = false;

    /**
     * Initialize cache - load index from disk
     */
    static async init(): Promise<void> {
        if (this.initialized) return;

        try {
            // Ensure cache directory exists
            const dirExists = await RNFS.exists(CACHE_DIR);
            if (!dirExists) {
                await RNFS.mkdir(CACHE_DIR);
                console.log(`${LOG_PREFIX} Created cache directory`);
            }

            // Load existing index
            if (await RNFS.exists(CACHE_INDEX_FILE)) {
                const indexContent = await RNFS.readFile(CACHE_INDEX_FILE, 'utf8');
                this.cacheIndex = JSON.parse(indexContent);
                console.log(`${LOG_PREFIX} Loaded cache index with ${Object.keys(this.cacheIndex).length} entries`);

                // Clean expired entries
                await this.cleanExpired();
            }

            this.initialized = true;
        } catch (error) {
            console.error(`${LOG_PREFIX} Init error:`, error);
            this.cacheIndex = {};
            this.initialized = true;
        }
    }

    /**
     * Get cached subtitles for a movie/series by IMDB ID
     */
    static async getCached(imdbId: string): Promise<CachedSubtitleEntry | null> {
        await this.init();

        const entry = this.cacheIndex[imdbId];
        if (!entry) {
            console.log(`${LOG_PREFIX} No cache for:`, imdbId);
            return null;
        }

        // Check if cache is still fresh
        if (Date.now() - entry.fetchedAt > CACHE_MAX_AGE_MS) {
            console.log(`${LOG_PREFIX} Cache expired for:`, imdbId);
            await this.remove(imdbId);
            return null;
        }

        console.log(`${LOG_PREFIX} Cache hit for:`, imdbId, `(${entry.subtitles.length} subs)`);
        return entry;
    }

    /**
     * Cache subtitle list for a movie/series
     */
    static async cacheSubtitles(
        imdbId: string,
        fileName: string,
        subtitles: SubtitleResult[],
        sdhSubtitleId?: string
    ): Promise<void> {
        await this.init();

        console.log(`${LOG_PREFIX} Caching ${subtitles.length} subtitles for:`, imdbId);

        this.cacheIndex[imdbId] = {
            imdbId,
            fileName,
            fetchedAt: Date.now(),
            subtitles,
            sdhSubtitleId,
            downloadedPaths: {},
        };

        await this.saveIndex();
    }

    /**
     * Get path to downloaded subtitle file (if already downloaded)
     */
    static async getDownloadedPath(imdbId: string, subtitleId: string): Promise<string | null> {
        await this.init();

        const entry = this.cacheIndex[imdbId];
        const path = entry?.downloadedPaths[subtitleId];

        if (path) {
            // Verify file still exists
            const exists = await RNFS.exists(path);
            if (exists) {
                return path;
            }
            // Clean up stale reference
            delete entry.downloadedPaths[subtitleId];
            await this.saveIndex();
        }

        return null;
    }

    /**
     * Mark a subtitle as downloaded and store its path
     */
    static async setDownloadedPath(
        imdbId: string,
        subtitleId: string,
        filePath: string
    ): Promise<void> {
        await this.init();

        const entry = this.cacheIndex[imdbId];
        if (entry) {
            entry.downloadedPaths[subtitleId] = filePath;
            await this.saveIndex();
            console.log(`${LOG_PREFIX} Stored download path for:`, subtitleId);
        }
    }

    /**
     * Get all available subtitles for user selection (in video player)
     */
    static async getAvailableSubtitles(imdbId: string): Promise<SubtitleResult[]> {
        await this.init();
        return this.cacheIndex[imdbId]?.subtitles || [];
    }

    /**
     * Get the SDH subtitle ID that was selected for haptics
     */
    static getSelectedSDHId(imdbId: string): string | undefined {
        return this.cacheIndex[imdbId]?.sdhSubtitleId;
    }

    /**
     * Update the selected SDH subtitle
     */
    static async setSelectedSDH(imdbId: string, subtitleId: string): Promise<void> {
        await this.init();

        const entry = this.cacheIndex[imdbId];
        if (entry) {
            entry.sdhSubtitleId = subtitleId;
            await this.saveIndex();
        }
    }

    /**
     * Remove cache entry
     */
    static async remove(imdbId: string): Promise<void> {
        const entry = this.cacheIndex[imdbId];
        if (!entry) return;

        console.log(`${LOG_PREFIX} Removing cache for:`, imdbId);

        // Delete downloaded files
        for (const filePath of Object.values(entry.downloadedPaths)) {
            try {
                if (await RNFS.exists(filePath)) {
                    await RNFS.unlink(filePath);
                }
            } catch (e) {
                console.warn(`${LOG_PREFIX} Failed to delete file:`, filePath);
            }
        }

        delete this.cacheIndex[imdbId];
        await this.saveIndex();
    }

    /**
     * Generate a cache file path for a subtitle
     */
    static getSubtitleCachePath(subtitleId: string, extension = 'srt'): string {
        return `${CACHE_DIR}/${subtitleId}.${extension}`;
    }

    private static async cleanExpired(): Promise<void> {
        const now = Date.now();
        const expiredIds = Object.entries(this.cacheIndex)
            .filter(([_, entry]) => now - entry.fetchedAt > CACHE_MAX_AGE_MS)
            .map(([id]) => id);

        if (expiredIds.length > 0) {
            console.log(`${LOG_PREFIX} Cleaning ${expiredIds.length} expired entries`);
            for (const id of expiredIds) {
                await this.remove(id);
            }
        }
    }

    private static async saveIndex(): Promise<void> {
        try {
            await RNFS.writeFile(
                CACHE_INDEX_FILE,
                JSON.stringify(this.cacheIndex, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error(`${LOG_PREFIX} Failed to save index:`, error);
        }
    }

    /**
     * Clear all cache
     */
    static async clearAll(): Promise<void> {
        console.log(`${LOG_PREFIX} Clearing all cache`);
        try {
            if (await RNFS.exists(CACHE_DIR)) {
                await RNFS.unlink(CACHE_DIR);
            }
            await RNFS.mkdir(CACHE_DIR);
            this.cacheIndex = {};
            this.initialized = false;
        } catch (error) {
            console.error(`${LOG_PREFIX} Failed to clear cache:`, error);
        }
    }

    /**
     * Get cache statistics
     */
    static async getStats(): Promise<{
        entryCount: number;
        totalSubtitles: number;
        downloadedCount: number;
    }> {
        await this.init();

        let totalSubtitles = 0;
        let downloadedCount = 0;

        for (const entry of Object.values(this.cacheIndex)) {
            totalSubtitles += entry.subtitles.length;
            downloadedCount += Object.keys(entry.downloadedPaths).length;
        }

        return {
            entryCount: Object.keys(this.cacheIndex).length,
            totalSubtitles,
            downloadedCount,
        };
    }
}
