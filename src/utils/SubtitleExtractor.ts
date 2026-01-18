// utils/SubtitleExtractor.ts

import { FFmpegKit, FFprobeKit, FFmpegKitConfig, ReturnCode, Level } from 'react-native-ffmpeg-kit';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { Platform } from 'react-native';
import { FileService } from '@/services/FileService';
import SimpleThumbnail from '../../libs/react-native-simple-thumbnail';

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
     * Resolve video path to FFmpeg-compatible format
     */
    private static async resolveVideoPath(videoPath: string): Promise<string> {
        const startTime = Date.now();
        console.log(`${LOG_PREFIX} [resolveVideoPath] START`, {
            originalPath: videoPath,
            isContentUri: videoPath.startsWith('content://'),
            platform: Platform.OS,
        });

        // Silence FFmpeg logs
        await FFmpegKitConfig.setLogLevel(Level.AV_LOG_ERROR);

        try {
            // If it's already a file path, validate and return
            if (videoPath.startsWith('file://') || (!videoPath.includes('://'))) {
                const cleanPath = videoPath.replace(/^file:\/\//, '');
                const exists = await RNFS.exists(cleanPath);

                if (exists) {
                    console.log(`${LOG_PREFIX} [resolveVideoPath] Using file path directly`, {
                        path: cleanPath,
                        durationMs: Date.now() - startTime,
                    });
                    return cleanPath;
                }

                console.warn(`${LOG_PREFIX} [resolveVideoPath] File path doesn't exist:`, cleanPath);
            }

            // Try to get real file path first (best option)
            if (Platform.OS === 'android' && videoPath.startsWith('content://')) {
                try {
                    const realPath = await FileService.resolveToRealPath(videoPath);

                    if (realPath && realPath !== videoPath && !realPath.startsWith('content://')) {
                        const cleanPath = realPath.replace(/^file:\/\//, '');
                        const exists = await RNFS.exists(cleanPath);

                        if (exists) {
                            const duration = Date.now() - startTime;
                            console.log(`${LOG_PREFIX} [resolveVideoPath] ✓ Resolved to real path`, {
                                originalUri: videoPath.substring(0, 60) + '...',
                                realPath: cleanPath.substring(0, 60) + '...',
                                durationMs: duration,
                            });
                            return cleanPath;
                        }
                    }
                } catch (error) {
                    console.warn(`${LOG_PREFIX} [resolveVideoPath] Real path resolution failed:`, error);
                }

                // Fallback: Use FFmpegKit SAF
                try {
                    const safPath = await FFmpegKitConfig.getSafParameterForRead(videoPath);
                    const duration = Date.now() - startTime;
                    console.log(`${LOG_PREFIX} [resolveVideoPath] ✓ Using SAF protocol`, {
                        originalUri: videoPath.substring(0, 60) + '...',
                        safPath: safPath.substring(0, 60) + '...',
                        durationMs: duration,
                    });
                    return safPath;
                } catch (safError) {
                    console.error(`${LOG_PREFIX} [resolveVideoPath] SAF conversion failed`, {
                        error: safError instanceof Error ? safError.message : String(safError),
                    });
                    throw new Error(`Cannot resolve content URI. SAF failed: ${safError}`);
                }
            }

            // For iOS or other URIs, return as-is
            const duration = Date.now() - startTime;
            console.log(`${LOG_PREFIX} [resolveVideoPath] Using original path`, {
                path: videoPath,
                durationMs: duration,
            });
            return videoPath;

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`${LOG_PREFIX} [resolveVideoPath] FATAL ERROR`, {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                originalPath: videoPath,
                durationMs: duration,
            });
            throw error;
        }
    }

    /**
     * Get subtitle tracks only from video
     */
    static async getSubtitleTracks(videoPath: string): Promise<SubtitleTrack[]> {
        const startTime = Date.now();
        console.log(`${LOG_PREFIX} [getSubtitleTracks] START`, {
            videoPath: videoPath.substring(0, 60) + '...',
            timestamp: new Date().toISOString(),
        });

        try {
            // Silence FFmpeg logs
            await FFmpegKitConfig.setLogLevel(Level.AV_LOG_ERROR);

            // For content:// URIs on Android, use native probe with file descriptor
            // This works even when the minimal FFmpeg build lacks SAF protocol support
            if (Platform.OS === 'android' && videoPath.startsWith('content://')) {
                console.log(`${LOG_PREFIX} [getSubtitleTracks] Using native probe for content URI`);

                try {
                    const output = await SimpleThumbnail.probeSubtitleTracks(videoPath);

                    if (output) {
                        const data = JSON.parse(output);
                        console.log(`${LOG_PREFIX} [getSubtitleTracks] Native probe result`, {
                            hasStreams: !!data.streams,
                            streamCount: data.streams?.length || 0,
                        });

                        const tracks = this.parseSubtitleStreams(data);
                        const duration = Date.now() - startTime;
                        console.log(`${LOG_PREFIX} [getSubtitleTracks] ✓ SUCCESS (native)`, {
                            subtitleTracks: tracks.length,
                            durationMs: duration,
                        });
                        return tracks;
                    }
                } catch (nativeError) {
                    console.warn(`${LOG_PREFIX} [getSubtitleTracks] Native probe failed, trying fallback`, {
                        error: nativeError instanceof Error ? nativeError.message : String(nativeError),
                    });
                    // Fall through to try resolving path and using FFprobe
                }
            }

            // Resolve path and use standard FFprobe
            const resolvedPath = await this.resolveVideoPath(videoPath);
            console.log(`${LOG_PREFIX} [getSubtitleTracks] Path resolved for FFprobe`);

            const command = `-v quiet -print_format json -show_streams -select_streams s "${resolvedPath}"`;
            console.log(`${LOG_PREFIX} [getSubtitleTracks] Executing FFprobe`);

            const session = await FFprobeKit.execute(command);
            const returnCode = await session.getReturnCode();

            console.log(`${LOG_PREFIX} [getSubtitleTracks] FFprobe return code`, {
                code: returnCode?.getValue(),
                isSuccess: ReturnCode.isSuccess(returnCode),
            });

            if (!ReturnCode.isSuccess(returnCode)) {
                const output = await session.getOutput();
                const failStackTrace = await session.getFailStackTrace();
                console.error(`${LOG_PREFIX} [getSubtitleTracks] FFprobe failed`, {
                    returnCode: returnCode?.getValue(),
                    output: output?.substring(0, 500),
                    failStackTrace: failStackTrace?.substring(0, 500),
                });
                return [];
            }

            const output = await session.getOutput();

            if (!output || output.trim().length === 0) {
                console.log(`${LOG_PREFIX} [getSubtitleTracks] No subtitle streams found`);
                return [];
            }

            let data;
            try {
                data = JSON.parse(output);
                console.log(`${LOG_PREFIX} [getSubtitleTracks] JSON parsed`, {
                    hasStreams: !!data.streams,
                    streamCount: data.streams?.length || 0,
                });
            } catch (parseError) {
                console.error(`${LOG_PREFIX} [getSubtitleTracks] JSON parse error`, {
                    error: parseError instanceof Error ? parseError.message : String(parseError),
                    outputPreview: output.substring(0, 200),
                });
                return [];
            }

            const tracks = this.parseSubtitleStreams(data);

            const duration = Date.now() - startTime;
            console.log(`${LOG_PREFIX} [getSubtitleTracks] ✓ SUCCESS`, {
                subtitleTracks: tracks.length,
                durationMs: duration,
            });

            return tracks;
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`${LOG_PREFIX} [getSubtitleTracks] FATAL ERROR`, {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                videoPath: videoPath.substring(0, 60) + '...',
                durationMs: duration,
            });
            return [];
        }
    }

    /**
     * Parse subtitle streams from FFprobe JSON output
     */
    private static parseSubtitleStreams(data: any): SubtitleTrack[] {
        const tracks: SubtitleTrack[] = [];

        if (!data.streams || !Array.isArray(data.streams)) {
            return [];
        }

        data.streams.forEach((stream: any) => {
            if (stream.codec_type === 'subtitle') {
                const track: SubtitleTrack = {
                    index: stream.index,
                    codec: stream.codec_name || 'unknown',
                    language: stream.tags?.language || 'und',
                    title: stream.tags?.title || `Subtitle ${stream.index}`,
                    isDefault: stream.disposition?.default === 1,
                    isForced: stream.disposition?.forced === 1,
                    isBitmap: SubtitleExtractor.isBitmapSubtitle(stream.codec_name || ''),
                };
                tracks.push(track);
            }
        });

        return tracks;
    }

    /**
     * Extract subtitle track to file
     */
    static async extractSubtitle(
        videoPath: string,
        subtitleIndex: number,
        outputFormat: 'srt' | 'vtt' | 'ass' = 'srt'
    ): Promise<string | null> {
        const startTime = Date.now();
        console.log(`${LOG_PREFIX} [extractSubtitle] START`, {
            videoPath: videoPath.substring(0, 60) + '...',
            subtitleIndex,
            outputFormat,
            timestamp: new Date().toISOString(),
        });

        try {
            // Silence FFmpeg logs
            await FFmpegKitConfig.setLogLevel(Level.AV_LOG_ERROR);

            const outputPath = `${RNFS.CachesDirectoryPath}/subtitle_${Date.now()}.${outputFormat}`;
            console.log(`${LOG_PREFIX} [extractSubtitle] Output path:`, outputPath);

            // For content:// URIs on Android, use native extraction with file descriptor
            // This works even when the minimal FFmpeg build lacks SAF protocol support
            if (Platform.OS === 'android' && videoPath.startsWith('content://')) {
                console.log(`${LOG_PREFIX} [extractSubtitle] Using native extraction for content URI`);

                try {
                    const result = await SimpleThumbnail.extractSubtitle(
                        videoPath,
                        subtitleIndex,
                        outputPath,
                        outputFormat
                    );

                    if (result) {
                        const exists = await RNFS.exists(result);
                        if (exists) {
                            const fileInfo = await RNFS.stat(result);
                            const duration = Date.now() - startTime;
                            console.log(`${LOG_PREFIX} [extractSubtitle] ✓ SUCCESS (native)`, {
                                outputPath: result,
                                fileSize: fileInfo.size,
                                fileSizeKB: (fileInfo.size / 1024).toFixed(2),
                                durationMs: duration,
                            });
                            return result;
                        }
                    }

                    console.warn(`${LOG_PREFIX} [extractSubtitle] Native extraction returned no result`);
                } catch (nativeError) {
                    console.warn(`${LOG_PREFIX} [extractSubtitle] Native extraction failed, trying fallback`, {
                        error: nativeError instanceof Error ? nativeError.message : String(nativeError),
                    });
                    // Fall through to try resolving path and using FFmpeg
                }
            }

            // Resolve path and use standard FFmpeg
            const resolvedPath = await this.resolveVideoPath(videoPath);
            console.log(`${LOG_PREFIX} [extractSubtitle] Path resolved for FFmpeg`);

            const codecMap: Record<string, string> = {
                srt: 'srt',
                vtt: 'webvtt',
                ass: 'ass',
            };
            const codec = codecMap[outputFormat];
            const command = `-v quiet -i "${resolvedPath}" -map 0:${subtitleIndex} -c:s ${codec} "${outputPath}"`;
            if (__DEV__) console.log(`${LOG_PREFIX} [extractSubtitle] Executing FFmpeg`);

            const session = await FFmpegKit.execute(command);
            const returnCode = await session.getReturnCode();

            if (ReturnCode.isSuccess(returnCode)) {
                if (await RNFS.exists(outputPath)) {
                    if (__DEV__) {
                        console.log(`${LOG_PREFIX} [extractSubtitle] ✓ SUCCESS`, {
                            outputPath,
                            durationMs: Date.now() - startTime,
                        });
                    }
                    return outputPath;
                }
            } else {
                const logs = await session.getAllLogsAsString();
                console.error(`${LOG_PREFIX} [extractSubtitle] FAILED. Logs: ${logs}`);
            }

            const output = await session.getOutput();
            const failStackTrace = await session.getFailStackTrace();
            const duration = Date.now() - startTime;

            console.error(`${LOG_PREFIX} [extractSubtitle] Extraction failed`, {
                returnCode: returnCode?.getValue(),
                output: output?.substring(0, 500),
                failStackTrace: failStackTrace?.substring(0, 500),
                durationMs: duration,
            });

            return null;
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`${LOG_PREFIX} [extractSubtitle] FATAL ERROR`, {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                videoPath: videoPath.substring(0, 60) + '...',
                subtitleIndex,
                outputFormat,
                durationMs: duration,
            });
            return null;
        }
    }

    /**
     * Read subtitle file content
     */
    static async readSubtitleFile(filePath: string): Promise<string | null> {
        const startTime = Date.now();
        console.log(`${LOG_PREFIX} [readSubtitleFile] START`, {
            filePath: filePath.substring(0, 60) + '...',
            timestamp: new Date().toISOString(),
        });

        try {
            const exists = await RNFS.exists(filePath);
            if (!exists) {
                console.error(`${LOG_PREFIX} [readSubtitleFile] File does not exist`, {
                    filePath,
                });
                return null;
            }

            const fileInfo = await RNFS.stat(filePath);
            console.log(`${LOG_PREFIX} [readSubtitleFile] Reading file`, {
                size: fileInfo.size,
                sizeKB: (fileInfo.size / 1024).toFixed(2),
            });

            const content = await RNFS.readFile(filePath, 'utf8');
            const duration = Date.now() - startTime;

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
        console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] START`, {
            cachesDir: RNFS.CachesDirectoryPath,
            timestamp: new Date().toISOString(),
        });

        try {
            const files = await RNFS.readDir(RNFS.CachesDirectoryPath);
            console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] Files found`, {
                totalFiles: files.length,
            });

            const tempFiles = files.filter((file) =>
                file.name.match(/^subtitle_\d+\.(srt|vtt|ass)$/)
            );

            console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] Subtitle files to clean`, {
                count: tempFiles.length,
                files: tempFiles.map(f => f.name),
            });

            if (tempFiles.length === 0) {
                console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] No files to clean`);
                return;
            }

            const results = await Promise.allSettled(
                tempFiles.map(async (file) => {
                    try {
                        await RNFS.unlink(file.path);
                        console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] ✓ Deleted:`, file.name);
                        return { success: true, name: file.name };
                    } catch (err) {
                        console.error(`${LOG_PREFIX} [cleanupSubtitleFiles] Failed to delete:`, {
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

            console.log(`${LOG_PREFIX} [cleanupSubtitleFiles] ✓ COMPLETED`, {
                total: tempFiles.length,
                succeeded,
                failed,
                durationMs: duration,
            });
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