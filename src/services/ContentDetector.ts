// src/services/ContentDetector.ts
import { OMDBService, OMDBResult } from './OMDBService';
import { FilenameParser } from '../utils/FilenameParser';

const LOG_PREFIX = '[ContentDetector]';

export interface ContentClassification {
    isPlayableContent: boolean;  // Movie OR Series (not home video)
    contentType: 'movie' | 'series' | 'home_video' | 'unknown';
    confidence: number;  // 0-1
    parsedTitle?: string;
    parsedYear?: number;
    omdbData?: OMDBResult;
    imdbId?: string;
}

// Scene release patterns - highly reliable indicators of professional content
const RELEASE_PATTERNS = [
    // Quality indicators
    /\b(1080p|720p|480p|2160p|4k|uhd)\b/i,
    // Source indicators
    /\b(bluray|bdrip|brrip|webrip|web-?dl|hdtv|dvdrip|hdrip|hdcam|hd-?rip)\b/i,
    // Codec indicators
    /\b(x264|x265|hevc|avc|xvid|divx|h\.?264|h\.?265)\b/i,
    // Audio indicators
    /\b(aac|ac3|dts|truehd|atmos|dd5\.?1|5\.1|7\.1)\b/i,
    // HDR indicators
    /\b(hdr|hdr10|dolby.?vision|dv)\b/i,
    // Release group pattern (typically at end with hyphen)
    /-[a-zA-Z0-9]{2,10}$/,
];

// TV series patterns - detect episode notation
const SERIES_PATTERNS = [
    /S\d{1,2}E\d{1,2}/i,           // S01E01, S1E1
    /Season\s*\d+/i,               // Season 1
    /\d{1,2}x\d{1,2}/i,            // 1x01
    /Episode\s*\d+/i,              // Episode 1
    /\bE\d{2,}\b/i,                // E01 (standalone)
    /\bEp\.?\s*\d+/i,              // Ep 1, Ep.1
    /\[\d{1,2}\/\d{1,2}\]/,        // [01/12] episode notation
];

// Home video patterns - definitely NOT movies/series
const HOME_VIDEO_PATTERNS = [
    /^VID[-_]\d{8}/i,              // VID_20241205
    /^IMG[-_]\d{8}/i,              // IMG_20241205
    /^MVI[-_]?\d{4}/i,             // MVI_1234
    /^DSC[-_]?\d{4}/i,             // DSC_1234
    /^MOV[-_]?\d{4}/i,             // MOV_1234
    /^DCIM/i,                      // Camera folder videos
    /^Screen[-_]?Recording/i,      // Screen recordings
    /^WhatsApp[-_]Video/i,         // WhatsApp videos
    /^Telegram[-_]/i,              // Telegram videos
    /^InShot/i,                    // InShot edited videos
    /^Snapchat/i,                  // Snapchat videos
    /^Instagram/i,                 // Instagram videos
    /^TikTok/i,                    // TikTok videos
    /^Record[-_]\d{4}/i,           // Record_0001
    /^\d{8}[-_]\d{6}/,             // 20241205_143022
    /^PXL_\d{8}/i,                 // Pixel phone format
    /^GOPR\d{4}/i,                 // GoPro format
];

export class ContentDetector {
    /**
     * Main detection method - analyzes filename and optionally verifies with OMDB
     */
    static async classify(
        filename: string,
        verifyWithOMDB: boolean = true
    ): Promise<ContentClassification> {
        const startTime = Date.now();
        console.log(`${LOG_PREFIX} Classifying:`, filename);

        // Step 1: Quick reject home videos (no API call needed)
        if (this.isHomeVideo(filename)) {
            console.log(`${LOG_PREFIX} Detected as home video`);
            return {
                isPlayableContent: false,
                contentType: 'home_video',
                confidence: 0.95,
            };
        }

        // Step 2: Check for series patterns
        const isSeries = this.hasSeriesPattern(filename);
        if (isSeries) {
            console.log(`${LOG_PREFIX} Detected series pattern`);
        }

        // Step 3: Check for release patterns (movies OR series)
        const releaseScore = this.calculateReleaseScore(filename);
        console.log(`${LOG_PREFIX} Release pattern score:`, releaseScore);

        // Step 4: Extract title and year from filename
        const parsed = FilenameParser.parse(filename);
        console.log(`${LOG_PREFIX} Parsed:`, parsed);

        // Step 5: If high confidence from patterns alone and no OMDB needed
        if (releaseScore >= 3 && !verifyWithOMDB) {
            return {
                isPlayableContent: true,
                contentType: isSeries ? 'series' : 'movie',
                confidence: Math.min(0.85, 0.5 + releaseScore * 0.1),
                parsedTitle: parsed.title,
                parsedYear: parsed.year,
            };
        }

        // Step 6: Verify with OMDB for high confidence
        // Allow short titles (like "Us", "Up") ONLY if we have a year to avoid false positives
        if (verifyWithOMDB && parsed.title && (parsed.title.length > 1 || (parsed.title.length > 0 && parsed.year))) {
            try {
                const omdbResult = await OMDBService.search(parsed.title, parsed.year);

                if (omdbResult) {
                    const duration = Date.now() - startTime;
                    console.log(`${LOG_PREFIX} OMDB verified in ${duration}ms:`, {
                        title: omdbResult.Title,
                        type: omdbResult.Type,
                    });

                    return {
                        isPlayableContent: true,
                        contentType: omdbResult.Type === 'series' ? 'series' : 'movie',
                        confidence: 0.95,
                        parsedTitle: omdbResult.Title,
                        parsedYear: parseInt(omdbResult.Year),
                        omdbData: omdbResult,
                        imdbId: omdbResult.imdbID,
                    };
                }
            } catch (error) {
                console.warn(`${LOG_PREFIX} OMDB verification failed:`, error);
            }
        }

        // Step 7: Fallback based on release patterns only
        if (releaseScore >= 2) {
            console.log(`${LOG_PREFIX} Fallback: using pattern score`);
            return {
                isPlayableContent: true,
                contentType: isSeries ? 'series' : 'movie',
                confidence: 0.6,
                parsedTitle: parsed.title,
                parsedYear: parsed.year,
            };
        }

        // Step 8: Unknown - treat as potentially playable with low confidence
        console.log(`${LOG_PREFIX} Unknown content type`);
        return {
            isPlayableContent: releaseScore >= 1,
            contentType: 'unknown',
            confidence: 0.3,
            parsedTitle: parsed.title,
        };
    }

    /**
     * Quick sync check without OMDB - for initial filtering
     */
    static classifySync(filename: string): {
        likelyContent: boolean;
        contentType: 'movie' | 'series' | 'home_video' | 'unknown';
    } {
        if (this.isHomeVideo(filename)) {
            return { likelyContent: false, contentType: 'home_video' };
        }

        const isSeries = this.hasSeriesPattern(filename);
        const releaseScore = this.calculateReleaseScore(filename);

        if (releaseScore >= 2 || isSeries) {
            return {
                likelyContent: true,
                contentType: isSeries ? 'series' : 'movie',
            };
        }

        return { likelyContent: false, contentType: 'unknown' };
    }

    private static isHomeVideo(filename: string): boolean {
        return HOME_VIDEO_PATTERNS.some(pattern => pattern.test(filename));
    }

    private static hasSeriesPattern(filename: string): boolean {
        // Replace separators with spaces to ensure word boundaries and space-based patterns work
        const normalized = filename.replace(/[._]/g, ' ');
        return SERIES_PATTERNS.some(pattern => pattern.test(normalized));
    }

    private static calculateReleaseScore(filename: string): number {
        // Replace separators with spaces to ensure word boundaries work (especially for \b regexes)
        const normalized = filename.replace(/[._]/g, ' ');
        return RELEASE_PATTERNS.filter(pattern => pattern.test(normalized)).length;
    }
}
