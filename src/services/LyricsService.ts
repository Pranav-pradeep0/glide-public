import { Platform } from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { pick } from '@react-native-documents/picker';
import { createMMKV } from 'react-native-mmkv';
import { LyricLine } from '@/types';

const lyricsMMKV = createMMKV({ id: 'glide_lyrics_cache_v1' });

/**
 * Parses LRC format strings into an array of time-indexed lines.
 * Supports standard [mm:ss.xx], [mm:ss.xxx], and 1-digit fractions like [mm:ss.x].
 * Also supports multi-tag lines like [mm:ss.xx][mm:ss.yy].
 */
export function parseLrc(content: string): LyricLine[] {
    const lines = content.split(/\r?\n/);
    const result: LyricLine[] = [];
    const timeTagRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        timeTagRegex.lastIndex = 0;
        const matches: number[] = [];
        let match: RegExpExecArray | null;

        while ((match = timeTagRegex.exec(line)) !== null) {
            const min = parseInt(match[1], 10);
            const sec = parseInt(match[2], 10);
            const fraction = match[3] ? parseFloat(`0.${match[3]}`) : 0;
            const timeInSeconds = min * 60 + sec + fraction;
            matches.push(timeInSeconds);
        }

        if (matches.length > 0) {
            const text = line.replace(timeTagRegex, '').trim();
            for (const time of matches) {
                result.push({ time, text });
            }
        }
    }

    result.sort((a, b) => a.time - b.time);
    return result;
}

export class LyricsServiceClass {
    private cache = new Map<string, LyricLine[] | null>();

    async getLyricsForTrack(trackId: string, filePath?: string): Promise<LyricLine[] | null> {
        if (!trackId && !filePath) return null;
        const cacheKey = trackId || filePath || '';

        // 1. In-memory cache
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey) ?? null;
        }

        // 2. Persistent storage (saved via document picker)
        if (trackId) {
            try {
                const storedLrc = lyricsMMKV.getString(`lyrics_${trackId}`);
                if (storedLrc) {
                    const parsed = parseLrc(storedLrc);
                    if (parsed.length > 0) {
                        this.cache.set(cacheKey, parsed);
                        return parsed;
                    }
                }
            } catch {
                // Ignore storage errors
            }
        }

        // 3. Fallback to reading companion .lrc file next to audio (works on Android <= 10 or accessible paths)
        if (filePath) {
            try {
                const lrcPath = filePath.replace(/\.[^/.]+$/, '.lrc');
                const exists = await RNFS.exists(lrcPath);
                if (exists) {
                    const rawContent = await RNFS.readFile(lrcPath, 'utf8');
                    const parsed = parseLrc(rawContent);
                    const finalResult = parsed.length > 0 ? parsed : null;
                    if (finalResult && trackId) {
                        try {
                            lyricsMMKV.set(`lyrics_${trackId}`, rawContent);
                        } catch {
                            // ignore
                        }
                    }
                    this.cache.set(cacheKey, finalResult);
                    return finalResult;
                }
            } catch {
                // Ignore filesystem errors
            }
        }

        this.cache.set(cacheKey, null);
        return null;
    }

    async pickAndSaveLyrics(trackId: string): Promise<LyricLine[] | null> {
        try {
            const result = await pick({
                mode: 'open',
                type: ['text/*', '*/*'],
            });

            if (!result || result.length === 0) return null;

            const file = result[0];
            let targetPath = file.uri;

            if (Platform.OS === 'android' && targetPath.startsWith('content://')) {
                const cachePath = `${RNFS.CachesDirectoryPath}/picked_lyrics_${Date.now()}.lrc`;
                await RNFS.copyFile(targetPath, cachePath);
                targetPath = cachePath;
            }

            const rawContent = await RNFS.readFile(targetPath, 'utf8');
            const parsed = parseLrc(rawContent);

            if (parsed.length > 0) {
                if (trackId) {
                    lyricsMMKV.set(`lyrics_${trackId}`, rawContent);
                }
                this.cache.set(trackId, parsed);
                return parsed;
            }
            return null;
        } catch (err) {
            console.warn('[LyricsService] Error picking lyrics:', err);
            return null;
        }
    }

    clearCache() {
        this.cache.clear();
    }
}

export const LyricsService = new LyricsServiceClass();
