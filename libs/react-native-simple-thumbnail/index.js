import { NativeModules } from 'react-native';

const { SimpleThumbnail } = NativeModules;

export default {
    /**
     * Generate a thumbnail for a video.
     * @param options { source, dest, time, width, height, quality, format }
     * @returns Promise<{ path: string, width: number, height: number }>
     */
    generate(options) {
        return SimpleThumbnail.generate(options);
    },

    /**
     * Resolve a content:// URI to a file path (if possible).
     * @param uri 
     * @returns Promise<string>
     */
    getRealPath(uri) {
        return SimpleThumbnail.getRealPath(uri);
    },

    /**
     * Probe subtitle tracks from a content:// URI using native FFprobe with file descriptor.
     * This works even when the minimal FFmpeg build lacks SAF protocol support.
     * @param contentUri The content:// URI to probe
     * @returns Promise<string> JSON string with subtitle track information
     */
    probeSubtitleTracks(contentUri) {
        return SimpleThumbnail.probeSubtitleTracks(contentUri);
    },

    /**
     * Extract a subtitle track from a content:// URI using native FFmpeg with file descriptor.
     * @param contentUri The content:// URI of the video
     * @param subtitleIndex The index of the subtitle stream to extract
     * @param outputPath The path to write the extracted subtitle file
     * @param outputFormat The output format (srt, vtt, ass)
     * @returns Promise<string|null> The path to the extracted subtitle file, or null on error
     */
    extractSubtitle(contentUri, subtitleIndex, outputPath, outputFormat) {
        return SimpleThumbnail.extractSubtitle(contentUri, subtitleIndex, outputPath, outputFormat);
    }
};
