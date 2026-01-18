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
     * Checks the volume level of an audio file using FFmpeg volumedetect
     * @param audioPath Path to the audio file
     * @returns Mean volume in dB (e.g., -20.5), or -91.0 if silent/error
     */
    /**
     * Checks the volume level of an audio file by reading PCM data directly
     * @param audioPath Path to the audio file
     * @returns Mean volume in dB (e.g., -20.5), or -91.0 if silent/error
     */
    static async checkAudioVolume(audioPath: string): Promise<number> {
        console.log(`${LOG_PREFIX} Checking volume for: ${audioPath}`);

        try {
            // Read file as base64 (RNFS reads binary as base64)
            const base64Data = await RNFS.readFile(audioPath, 'base64');

            // Decode base64 to binary string (polyfill or manual)
            // React Native doesn't have Buffer globally available without polyfills often, 
            // so we do a simple manual decode or use fetch blob if available but RNFS is standard here.
            // Actually, we can just walk the base64 string or use a library, but simplest standard way:
            // Since we don't have Buffer in this context guaranteed, and importing it adds weight:
            // Let's use a helper if we have one or just simple base64 decoder.
            // Wait, we can assume Buffer is available or use `atob`. 
            // Most RN environments have `atob`.

            // To be safe and minimal: 
            // We can rely on `Buffer` if node libs are polyfilled (common in RN). 
            // If not, we iterate.
            // For robustness, I'll use Buffer.from if available, or a simple implementation.

            // Let's try Buffer. If it fails, catch error.
            let pcmData: Uint8Array;
            try {
                pcmData = Buffer.from(base64Data, 'base64');
            } catch (e) {
                // Fallback for environment without Buffer
                const binaryString = atob(base64Data);
                const len = binaryString.length;
                pcmData = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    pcmData[i] = binaryString.charCodeAt(i);
                }
            }

            // WAV Header is 44 bytes
            if (pcmData.length <= 44) {
                console.warn(`${LOG_PREFIX} Audio file too short for analysis`);
                return -91.0;
            }

            let sumSquares = 0.0;
            let sampleCount = 0;
            const headerSize = 44; // Standard WAV header

            // Process 16-bit Mono PCM (2 bytes per sample)
            // Little Endian
            for (let i = headerSize; i < pcmData.length - 1; i += 2) {
                // Read 16-bit signed integer
                const low = pcmData[i];
                const high = pcmData[i + 1];

                // Convert to signed 16-bit
                let sample = (high << 8) | low;
                if (sample & 0x8000) {
                    sample = sample - 0x10000;
                }

                sumSquares += sample * sample;
                sampleCount++;
            }

            if (sampleCount === 0) return -91.0;

            const meanSquare = sumSquares / sampleCount;
            const rms = Math.sqrt(meanSquare);

            // dBFS = 20 * log10(RMS / MaxPossibleAmplitude)
            // Max amplitude for 16-bit is 32768
            let db = 20 * Math.log10(rms / 32768);

            // Access floor at -91dB
            if (!isFinite(db) || db < -91) db = -91;

            console.log(`${LOG_PREFIX} Calculated RMS: ${rms.toFixed(2)}, dB: ${db.toFixed(1)}`);
            return db;

        } catch (error) {
            console.error(`${LOG_PREFIX} Volume check error (JS):`, error);
            // Non-fatal, just assume silence to be safe? 
            // If we assume silence on error, user gets "No Speech" which blocks them.
            // BETTER: If check fails, return high volume to ALLOW transcription as fallback.
            // The previous logic returned -91 which blocked the user.
            // If the file exists but we failed to parse, let's allow it -> return 0dB (loud)
            return 0.0;
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
