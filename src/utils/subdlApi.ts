// src/utils/subdlApi.ts

import { SubtitleResult } from '../types';
import { SUBDL_API_URL, SUBDL_API_KEY, SUBDL_DOWNLOAD_URL } from './constants';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { FilenameParser } from './FilenameParser';

const LOG_PREFIX = '[SubDL]';

// Constants for SDH detection
const SDH_KEYWORDS = [
    'sdh',
    'cc',
    'closed.caption',
    'closed-caption',
    'closedcaption',
    'hearing.impaired',
    'hearing-impaired',
    'hearingimpaired',
    'hi',
    'hoh',
    'deaf',
    'hard.of.hearing',
    'hard-of-hearing',
];

/**
 * Calculate SDH score based on multiple factors
 */
function calculateSDHScore(sub: any): number {
    let score = 0;
    const releaseName = (sub.release_name || '').toLowerCase();
    const comment = (sub.comment || '').toLowerCase();

    // Check release name for SDH keywords (highest weight)
    SDH_KEYWORDS.forEach(keyword => {
        if (releaseName.includes(keyword)) {
            score += 10;
        }
    });

    // Check comment for SDH indicators
    SDH_KEYWORDS.forEach(keyword => {
        if (comment.includes(keyword)) {
            score += 5;
        }
    });

    // SubDL API's hi field (hearing impaired flag)
    if (sub.hi === 1 || sub.hi === true) {
        score += 15;
    }

    // Check for common SDH phrases in comments
    const sdhPhrases = [
        'sound effects',
        'sound descriptions',
        'music descriptions',
        'speaker identification',
        'includes sounds',
        'for deaf',
        'for hard of hearing',
    ];

    sdhPhrases.forEach(phrase => {
        if (comment.includes(phrase)) {
            score += 8;
        }
    });

    return score;
}



/**
 * Search for subtitles using simplified approach
 * Uses only: film_name, type, year, languages
 * Does NOT use season/episode numbers as they cause issues with SubDL
 */
export async function searchAllSubtitles(
    videoName: string,
    language: string = 'en',
    imdbId?: string
): Promise<{
    subtitles: SubtitleResult[];
}> {
    try {
        const parsed = FilenameParser.parse(videoName);
        console.log(`${LOG_PREFIX} Parsed: "${parsed.title}", year=${parsed.year || 'unknown'}, isTVShow=${parsed.isTVShow}`);

        // Safeguard: If parsing resulted in empty title, use original
        if (!parsed.title || parsed.title.trim().length === 0) {
            console.warn(`${LOG_PREFIX} Warning: Parsed title is empty. Fallback to original.`);
            parsed.title = videoName;
        }

        const params = new URLSearchParams({
            api_key: SUBDL_API_KEY,
            languages: language,
            subs_per_page: '30',
            hi: '1',
            releases: '1',
            comment: '1', // Get author comments for better SDH scoring
        });

        // Always include file_name for better matching accuracy
        params.append('file_name', videoName);

        // Use IMDB ID if available (most accurate)
        if (imdbId) {
            params.append('imdb_id', imdbId);
            console.log(`${LOG_PREFIX} Using IMDB ID: ${imdbId}`);
        } else {
            // Use cleaned film name
            params.append('film_name', parsed.title);
        }

        // Add type and season/episode info
        if (parsed.isTVShow) {
            params.append('type', 'tv');

            // Add Season/Episode info for TV shows
            if (parsed.season !== undefined) {
                params.append('season_number', parsed.season.toString());
            }
            if (parsed.episode !== undefined) {
                params.append('episode_number', parsed.episode.toString());
            }
            if (parsed.fullSeason) {
                params.append('full_season', '1');
            }
        } else {
            params.append('type', 'movie');

            // Add year for movies if available
            if (parsed.year) {
                params.append('year', parsed.year.toString());
            }
        }

        console.log(`${LOG_PREFIX} Search params: ${params.toString()}`);

        const response = await fetch(`${SUBDL_API_URL}?${params}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            throw new Error(`SubDL API error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.subtitles || data.subtitles.length === 0) {
            console.log(`${LOG_PREFIX} No subtitles found`);

            // If year was specified, try without year
            if (parsed.year && !imdbId) {
                console.log(`${LOG_PREFIX} Retrying without year...`);
                const fallbackParams = new URLSearchParams({
                    api_key: SUBDL_API_KEY,
                    languages: language,
                    subs_per_page: '30',
                    hi: '1',
                    releases: '1',
                    film_name: parsed.title,
                });

                fallbackParams.append('file_name', videoName);

                if (parsed.isTVShow) {
                    fallbackParams.append('type', 'tv');
                    if (parsed.season !== undefined) {
                        fallbackParams.append('season_number', parsed.season.toString());
                    }
                    if (parsed.episode !== undefined) {
                        fallbackParams.append('episode_number', parsed.episode.toString());
                    }
                    if (parsed.fullSeason) {
                        fallbackParams.append('full_season', '1');
                    }
                } else {
                    fallbackParams.append('type', 'movie');
                }

                const fallbackResponse = await fetch(`${SUBDL_API_URL}?${fallbackParams}`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                });

                if (fallbackResponse.ok) {
                    const fallbackData = await fallbackResponse.json();
                    if (fallbackData.subtitles && fallbackData.subtitles.length > 0) {
                        console.log(`${LOG_PREFIX} Fallback found ${fallbackData.subtitles.length} subtitles`);
                        return processSubtitleResults(fallbackData.subtitles, parsed.title, language);
                    }
                }
            }

            return { subtitles: [] };
        }

        console.log(`${LOG_PREFIX} Found ${data.subtitles.length} subtitles`);
        return processSubtitleResults(data.subtitles, parsed.title, language);

    } catch (error) {
        console.error(`${LOG_PREFIX} Search error:`, error);
        return { subtitles: [] };
    }
}

/**
 * Search for SDH subtitles specifically
 * Uses same simplified approach
 */
export async function searchSDHSubtitles(
    videoName: string,
    language: string = 'en',
    imdbId?: string
): Promise<{
    subtitles: SubtitleResult[];
}> {
    // Use the same search as searchAllSubtitles
    // SDH filtering is done via scoring after results are returned
    return searchAllSubtitles(videoName, language, imdbId);
}

/**
 * Process subtitle results into our format
 */
function processSubtitleResults(
    subtitles: any[],
    defaultName: string,
    language: string
): { subtitles: SubtitleResult[] } {
    const allSubtitles: SubtitleResult[] = subtitles.map((sub: any, index: number) => ({
        id: sub.sd_id || sub.id || `sub_${index}`,
        name: sub.name || defaultName,
        language: sub.lang || language,
        release: sub.release_name || 'Unknown',
        downloadUrl: sub.url || sub.download_url || '',
        author: sub.author || 'Unknown',
        rating: sub.rating || 0,
        hearingImpaired: sub.hi === 1 || sub.hi === true,
        sdhScore: calculateSDHScore(sub),
        comment: sub.comment || '',
    }));

    // Sort by SDH score first (for SDH preference), then by rating
    allSubtitles.sort((a: any, b: any) => {
        // Prioritize SDH subtitles (score > 5)
        if (b.sdhScore !== a.sdhScore && (b.sdhScore > 5 || a.sdhScore > 5)) {
            return b.sdhScore - a.sdhScore;
        }
        return (b.rating || 0) - (a.rating || 0);
    });

    return { subtitles: allSubtitles };
}

/**
 * Download subtitle file from SubDL
 * Handles ZIP files by extracting and finding the .srt file inside
 */
export async function downloadSubtitle(
    downloadUrl: string
): Promise<string | null> {
    const timestamp = Date.now();
    const zipPath = `${RNFS.CachesDirectoryPath}/subtitle_${timestamp}.zip`;
    const extractDir = `${RNFS.CachesDirectoryPath}/subtitle_extract_${timestamp}`;

    try {
        // Build full URL if it's a relative path
        const fullUrl = downloadUrl.startsWith('http')
            ? downloadUrl
            : `${SUBDL_DOWNLOAD_URL}${downloadUrl}`;

        console.log(`${LOG_PREFIX} Downloading from:`, fullUrl);

        // Download the ZIP file
        const downloadResult = await RNFS.downloadFile({
            fromUrl: fullUrl,
            toFile: zipPath,
            headers: {
                'User-Agent': 'Glide/1.0',
            },
        }).promise;

        if (downloadResult.statusCode !== 200) {
            throw new Error(`Download failed with status: ${downloadResult.statusCode}`);
        }

        console.log(`${LOG_PREFIX} Downloaded ZIP (${downloadResult.bytesWritten} bytes)`);

        // Check if file exists and has content
        const fileExists = await RNFS.exists(zipPath);
        if (!fileExists) {
            throw new Error('Downloaded file does not exist');
        }

        // Create extraction directory
        await RNFS.mkdir(extractDir);

        // Extract the ZIP file
        console.log(`${LOG_PREFIX} Extracting ZIP to:`, extractDir);
        await unzip(zipPath, extractDir);

        // Find subtitle file in extracted contents
        const files = await RNFS.readDir(extractDir);
        console.log(`${LOG_PREFIX} Extracted ${files.length} files`);

        // Look for .srt, .vtt, or .ass files (prefer .srt)
        const subtitleExtensions = ['.srt', '.vtt', '.ass', '.ssa'];
        let subtitleFile = null;

        for (const ext of subtitleExtensions) {
            subtitleFile = files.find(f => f.name.toLowerCase().endsWith(ext));
            if (subtitleFile) break;
        }

        if (!subtitleFile) {
            // Check subdirectories (some ZIPs have nested folders)
            for (const file of files) {
                if (file.isDirectory()) {
                    const subFiles = await RNFS.readDir(file.path);
                    for (const ext of subtitleExtensions) {
                        subtitleFile = subFiles.find(f => f.name.toLowerCase().endsWith(ext));
                        if (subtitleFile) break;
                    }
                    if (subtitleFile) break;
                }
            }
        }

        if (!subtitleFile) {
            console.error(`${LOG_PREFIX} No subtitle file found in ZIP`);
            return null;
        }

        console.log(`${LOG_PREFIX} Found subtitle:`, subtitleFile.name);

        // Read the subtitle content
        const subtitleContent = await RNFS.readFile(subtitleFile.path, 'utf8');

        // Verify it's valid subtitle content
        if (!subtitleContent.includes('-->')) {
            console.error(`${LOG_PREFIX} File content is not valid subtitle format`);
            return null;
        }

        console.log(`${LOG_PREFIX} Loaded ${subtitleContent.length} chars from ${subtitleFile.name}`);
        return subtitleContent;

    } catch (error) {
        console.error(`${LOG_PREFIX} Download error:`, error);
        return null;
    } finally {
        // Cleanup temporary files
        try {
            if (await RNFS.exists(zipPath)) {
                await RNFS.unlink(zipPath);
            }
            if (await RNFS.exists(extractDir)) {
                await RNFS.unlink(extractDir);
            }
        } catch (cleanupError) {
            console.warn(`${LOG_PREFIX} Cleanup error:`, cleanupError);
        }
    }
}

/**
 * Search by IMDB ID directly
 */
export async function searchByIMDBId(
    imdbId: string,
    language: string = 'en'
): Promise<SubtitleResult[]> {
    const result = await searchAllSubtitles('', language, imdbId);
    return result.subtitles;
}