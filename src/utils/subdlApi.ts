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
    imdbId?: string,
    prioritizeSDH: boolean = true,
    signal?: AbortSignal,
    manualSeason?: number,
    manualEpisode?: number,
    manualYear?: number // Added
): Promise<{
    subtitles: SubtitleResult[];
}> {
    console.log(`${LOG_PREFIX} === Search Started ===`);
    console.log(`${LOG_PREFIX} videoName: "${videoName}", language: "${language}", imdbId: ${imdbId || 'none'}, prioritizeSDH: ${prioritizeSDH}, manualSeason: ${manualSeason || 'none'}, manualEpisode: ${manualEpisode || 'none'}, manualYear: ${manualYear || 'none'}`);
    try {
        const parsed = FilenameParser.parse(videoName);
        console.log(`${LOG_PREFIX} Parsed: "${parsed.title}", year=${parsed.year || 'unknown'}, isTVShow=${parsed.isTVShow}`);

        // Safeguard: If parsing resulted in empty title, use original
        if (!parsed.title || parsed.title.trim().length === 0) {
            console.warn(`${LOG_PREFIX} Warning: Parsed title is empty. Fallback to original.`);
        }

        const effectiveSeason = manualSeason !== undefined ? manualSeason : parsed.season;
        const effectiveEpisode = manualEpisode !== undefined ? manualEpisode : parsed.episode;
        const effectiveYear = manualYear !== undefined ? manualYear : parsed.year;

        const params = new URLSearchParams({
            api_key: SUBDL_API_KEY,
            languages: language,
            subs_per_page: '30',
            releases: '1',
            comment: '1', // Get author comments for better SDH scoring
            film_name: parsed.title || videoName, // Always use parsed title or fallback
            type: (parsed.isTVShow || manualSeason !== undefined || manualEpisode !== undefined) ? 'tv' : 'movie'
        });

        // Add year if available
        if (effectiveYear) {
            params.append('year', effectiveYear.toString());
        }

        // Only request HI subtitles when prioritizing SDH (for haptic play)
        if (prioritizeSDH) {
            params.append('hi', '1');
            console.log(`${LOG_PREFIX} Including hi=1 param (SDH prioritized)`);
        } else {
            console.log(`${LOG_PREFIX} NOT including hi param (general search)`);
        }

        // Always include file_name for better matching accuracy
        params.append('file_name', videoName);

        console.log(`${LOG_PREFIX} Using film_name: "${parsed.title}"`);

        // Also add IMDB ID if available (improves accuracy)
        if (imdbId) {
            params.append('imdb_id', imdbId);
            console.log(`${LOG_PREFIX} Also using IMDB ID: ${imdbId}`);
        }

        // Add type and season/episode info
        // Priority: Manual inputs > Parsed info
        if (parsed.isTVShow || manualSeason !== undefined || manualEpisode !== undefined) {
            // Add Season/Episode info for TV shows
            if (effectiveSeason !== undefined) {
                params.append('season_number', effectiveSeason.toString());
            }
            if (effectiveEpisode !== undefined) {
                params.append('episode_number', effectiveEpisode.toString());
            }
            if (parsed.fullSeason) {
                params.append('full_season', '1');
            }
        }

        console.log(`${LOG_PREFIX} Search params: ${params.toString()}`);

        const response = await fetch(`${SUBDL_API_URL}?${params}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal,
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
                    releases: '1',
                    film_name: parsed.title,
                });

                // Only include hi param when prioritizing SDH
                if (prioritizeSDH) {
                    fallbackParams.append('hi', '1');
                }

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
                    signal,
                });

                if (fallbackResponse.ok) {
                    const fallbackData = await fallbackResponse.json();
                    if (fallbackData.subtitles && fallbackData.subtitles.length > 0) {
                        console.log(`${LOG_PREFIX} Fallback found ${fallbackData.subtitles.length} subtitles`);
                        return processSubtitleResults(fallbackData.subtitles, parsed.title, language, prioritizeSDH);
                    }
                }
            }

            return { subtitles: [] };
        }

        console.log(`${LOG_PREFIX} Found ${data.subtitles.length} subtitles`);
        console.log(`${LOG_PREFIX} Passing prioritizeSDH=${prioritizeSDH} to processSubtitleResults`);
        return processSubtitleResults(data.subtitles, parsed.title, language, prioritizeSDH);

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
    language: string,
    prioritizeSDH: boolean = true
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

    // Sort subtitles based on priority preference
    console.log(`${LOG_PREFIX} Sorting ${allSubtitles.length} subtitles with prioritizeSDH=${prioritizeSDH}`);

    // Count SDH vs non-SDH before sorting
    const sdhCount = allSubtitles.filter(s => (s.sdhScore || 0) > 5 || s.hearingImpaired).length;
    const nonSdhCount = allSubtitles.length - sdhCount;
    console.log(`${LOG_PREFIX} SDH subtitles: ${sdhCount}, Non-SDH subtitles: ${nonSdhCount}`);

    allSubtitles.sort((a: any, b: any) => {
        if (prioritizeSDH) {
            // Prioritize SDH subtitles (score > 5), then by rating
            if (b.sdhScore !== a.sdhScore && (b.sdhScore > 5 || a.sdhScore > 5)) {
                return b.sdhScore - a.sdhScore;
            }
        }
        return (b.rating || 0) - (a.rating || 0);
    });

    // Log first 3 results after sorting
    console.log(`${LOG_PREFIX} Top 3 results after sorting (prioritizeSDH=${prioritizeSDH}):`);
    allSubtitles.slice(0, 3).forEach((sub, i) => {
        const isSDH = (sub.sdhScore || 0) > 5 || sub.hearingImpaired;
        console.log(`${LOG_PREFIX}   ${i + 1}. "${sub.release?.substring(0, 40)}..." - SDH: ${isSDH}, sdhScore: ${sub.sdhScore || 0}, rating: ${sub.rating || 0}`);
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