// utils/SubtitleExtractor.ts

import * as RNFS from '@dr.pogodin/react-native-fs';
import { Platform, NativeModules } from 'react-native';

const LOG_PREFIX = '[SubtitleExtractor]';

export interface SubtitleTrack {
    index: number;
    codec: string;
    language?: string;
    title?: string;
    isDefault?: boolean;
    isForced?: boolean;
    isBitmap?: boolean;
}

export class SubtitleExtractor {
    /**
     * Check if codec is text-based (can be extracted to SRT)
     */
    static isTextSubtitle(codec: string): boolean {
        const textCodecs = ['srt', 'subrip', 'ass', 'ssa', 'webvtt', 'vtt', 'mov_text', 'text', 'utf8', 'text/plain'];
        return textCodecs.includes(codec?.toLowerCase());
    }

    /**
     * Check if codec is bitmap-based (needs native rendering)
     */
    static isBitmapSubtitle(codec: string): boolean {
        const bitmapCodecs = ['hdmv_pgs_subtitle', 'pgs', 'dvd_subtitle', 'dvdsub', 'vobsub', 'idx', 'sub'];
        return bitmapCodecs.includes(codec?.toLowerCase());
    }

    /**
     * Get subtitle tracks only from video using native MediaExtractor
     */
    static async getSubtitleTracks(videoPath: string): Promise<SubtitleTrack[]> {
        const startTime = Date.now();
        if (__DEV__) {
            console.log(`${LOG_PREFIX} [getSubtitleTracks] START`, {
                videoPath: videoPath.substring(0, 60) + '...',
                timestamp: new Date().toISOString(),
            });
        }

        try {
            if (Platform.OS === 'android' && NativeModules.SubtitleSyncModule?.getSubtitleTracks) {
                const tracks: SubtitleTrack[] = await NativeModules.SubtitleSyncModule.getSubtitleTracks(videoPath);
                const duration = Date.now() - startTime;
                if (__DEV__) {
                    console.log(`${LOG_PREFIX} [getSubtitleTracks] ✓ SUCCESS (native)`, {
                        subtitleTracks: tracks?.length || 0,
                        durationMs: duration,
                    });
                }
                return tracks || [];
            }
            return [];
        } catch (error) {
            console.error(`${LOG_PREFIX} [getSubtitleTracks] Error getting subtitle tracks:`, error);
            return [];
        }
    }

    /**
     * Extract subtitle track to file.
     * Note: FFmpegKit has been retired. Player uses native subtitle rendering directly.
     */
    static async extractSubtitle(
        _videoPath: string,
        _subtitleIndex: number,
        _outputFormat: 'srt' | 'vtt' | 'ass' = 'srt'
    ): Promise<string | null> {
        return null;
    }

    /**
     * Read subtitle file content
     */
    static async readSubtitleFile(filePath: string): Promise<string | null> {
        const startTime = Date.now();
        if (__DEV__) {
            console.log(`${LOG_PREFIX} [readSubtitleFile] START`, {
                filePath: filePath.substring(0, 60) + '...',
                timestamp: new Date().toISOString(),
            });
        }

        try {
            const exists = await RNFS.exists(filePath);
            if (!exists) {
                console.error(`${LOG_PREFIX} [readSubtitleFile] File does not exist`, {
                    filePath,
                });
                return null;
            }

            const fileInfo = await RNFS.stat(filePath);
            if (__DEV__) {
                console.log(`${LOG_PREFIX} [readSubtitleFile] Reading file`, {
                    size: fileInfo.size,
                    sizeKB: (fileInfo.size / 1024).toFixed(2),
                });
            }

            const content = await RNFS.readFile(filePath, 'utf8');

            if (__DEV__) {
                console.log(`${LOG_PREFIX} [readSubtitleFile] ✓ SUCCESS`, {
                    sizeKB: (content.length / 1024).toFixed(2),
                    durationMs: Date.now() - startTime,
                });
            }

            return content;
        } catch (error) {
            console.error(`${LOG_PREFIX} [readSubtitleFile] FATAL ERROR`, error);
            return null;
        }
    }

    /**
     * Clean up temporary subtitle files
     */
    static async cleanupSubtitleFiles(): Promise<void> {
        const startTime = Date.now();
        if (__DEV__) {
            console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] START`, {
                cachesDir: RNFS.CachesDirectoryPath,
                timestamp: new Date().toISOString(),
            });
        }

        try {
            const files = await RNFS.readDir(RNFS.CachesDirectoryPath);
            if (__DEV__) {
                console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] Files found`, {
                    totalFiles: files.length,
                });
            }

            const tempFiles = files.filter((file) =>
                file.name.match(/^subtitle_\d+\.(srt|vtt|ass)$/)
            );

            if (__DEV__) {
                console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] Subtitle files to clean`, {
                    count: tempFiles.length,
                    files: tempFiles.map(f => f.name),
                });
            }

            if (tempFiles.length === 0) {
                if (__DEV__) { console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] No files to clean`); }
                return;
            }

            const results = await Promise.allSettled(
                tempFiles.map(async (file) => {
                    try {
                        await RNFS.unlink(file.path);
                        if (__DEV__) { console.log(`${LOG_PREFIX} ✓ Deleted:`, file.name); }
                        return { success: true, name: file.name };
                    } catch (err) {
                        console.error(`${LOG_PREFIX} Failed to delete:`, {
                            name: file.name,
                            error: err instanceof Error ? err.message : String(err),
                        });
                        return { success: false, name: file.name, error: err };
                    }
                })
            );

            const succeeded = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            const duration = Date.now() - startTime;

            if (__DEV__) {
                console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] ✓ COMPLETED`, {
                    total: tempFiles.length,
                    succeeded,
                    failed,
                    durationMs: duration,
                });
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`${LOG_PREFIX} [cleanupSubtitleFiles] FATAL ERROR`, {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                durationMs: duration,
            });
        }
    }
}
