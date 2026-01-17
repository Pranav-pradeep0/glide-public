// src/utils/AudioExtractor.ts

import { FFmpegKit, FFmpegKitConfig, ReturnCode, Level } from 'react-native-ffmpeg-kit';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { Platform } from 'react-native';
import { FileService } from '@/services/FileService';

const LOG_PREFIX = '[AudioExtractor]';

export class AudioExtractor {
    /**
     * Resolve video path to FFmpeg-compatible format
     */
    private static async resolveVideoPath(videoPath: string): Promise<string> {
        // Reuse logic from SubtitleExtractor for consistency
        await FFmpegKitConfig.setLogLevel(Level.AV_LOG_ERROR);

        if (Platform.OS === 'android' && videoPath.startsWith('content://')) {
            try {
                const realPath = await FileService.resolveToRealPath(videoPath);
                if (realPath && realPath !== videoPath && !realPath.startsWith('content://')) {
                    const cleanPath = realPath.replace(/^file:\/\//, '');
                    if (await RNFS.exists(cleanPath)) return cleanPath;
                }
            } catch (error) {
                console.warn(`${LOG_PREFIX} Real path resolution failed:`, error);
            }

            try {
                return await FFmpegKitConfig.getSafParameterForRead(videoPath);
            } catch (safError) {
                console.error(`${LOG_PREFIX} SAF conversion failed`, safError);
                throw new Error(`Cannot resolve content URI. SAF failed: ${safError}`);
            }
        }

        return videoPath.replace(/^file:\/\//, '');
    }

    /**
     * Extracts a small audio chunk from a video file
     * @param videoPath Path or Content URI of the video
     * @param startTime Start time in seconds
     * @param duration Duration in seconds
     * @returns Path to the extracted audio file (.m4a)
     */
    static async extractAudioChunk(
        videoPath: string,
        startTime: number,
        duration: number = 10
    ): Promise<string | null> {
        console.log(`${LOG_PREFIX} Extracting chunk at ${startTime}s for ${duration}s`);

        try {
            const resolvedPath = await this.resolveVideoPath(videoPath);
            const outputPath = `${RNFS.CachesDirectoryPath}/audio_chunk_${Date.now()}.wav`;

            // -ss before -i for fast seeking
            // -t for duration
            // -vn: no video
            // -ac 1: mono (saves space)
            // -ar 16000: 16kHz (best for Whisper)
            // -c:a pcm_s16le: RAW PCM output (supported by Groq, extremely light build)
            // -f wav: Force WAV muxer
            const command = `-ss ${startTime} -i "${resolvedPath}" -t ${duration} -vn -ac 1 -ar 16000 -c:a pcm_s16le -f wav -y "${outputPath}"`;

            console.log(`${LOG_PREFIX} Executing FFmpeg command: ${command}`);
            const session = await FFmpegKit.execute(command);
            const returnCode = await session.getReturnCode();

            if (ReturnCode.isSuccess(returnCode)) {
                if (await RNFS.exists(outputPath)) {
                    const stats = await RNFS.stat(outputPath);
                    console.log(`${LOG_PREFIX} Extraction success: ${outputPath} (${stats.size} bytes)`);
                    return outputPath;
                }
            }

            const output = await session.getOutput();
            console.error(`${LOG_PREFIX} Extraction failed`, output);
            return null;
        } catch (error) {
            console.error(`${LOG_PREFIX} Fatal error during extraction:`, error);
            return null;
        }
    }

    /**
     * Cleanup temporary audio files
     */
    static async cleanup() {
        try {
            const files = await RNFS.readDir(RNFS.CachesDirectoryPath);
            const chunks = files.filter(f =>
                f.name.startsWith('audio_chunk_') &&
                (f.name.endsWith('.m4a') || f.name.endsWith('.aac') || f.name.endsWith('.wav'))
            );
            for (const file of chunks) {
                await RNFS.unlink(file.path);
            }
        } catch (error) {
            console.warn(`${LOG_PREFIX} Cleanup failed:`, error);
        }
    }
}
