// src/services/OMDBService.ts
import { OMDB_API_KEY, OMDB_API_URL } from '../utils/constants';

const LOG_PREFIX = '[OMDBService]';

export interface OMDBResult {
    Title: string;
    Year: string;
    imdbID: string;
    Type: 'movie' | 'series' | 'episode';
    Poster: string;
    Response: 'True' | 'False';
    Error?: string;
    Runtime?: string;
    Genre?: string;
    Director?: string;
    Plot?: string;
    Rated?: string;
    imdbRating?: string;
    Ratings?: { Source: string; Value: string }[];
    Actors?: string;
    Writer?: string;
    Language?: string;
    Country?: string;
    Awards?: string;
    BoxOffice?: string;
}

export class OMDBService {
    /**
     * Search OMDB by title and optional year
     * Uses 't' parameter for exact title match (more accurate)
     * Returns null if no match or API error
     */
    static async search(title: string, year?: number): Promise<OMDBResult | null> {
        try {
            const params = new URLSearchParams({
                apikey: OMDB_API_KEY,
                t: title,
            });

            if (year) {
                params.append('y', year.toString());
            }

            console.log(`${LOG_PREFIX} Searching:`, { title, year });
            console.log(`${LOG_PREFIX} API Key present:`, !!OMDB_API_KEY, 'Length:', OMDB_API_KEY?.length);

            const response = await fetch(`${OMDB_API_URL}?${params}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                console.error(`${LOG_PREFIX} HTTP error:`, response.status);
                return null;
            }

            const data: OMDBResult = await response.json();

            if (data.Response === 'False') {
                console.log(`${LOG_PREFIX} No match:`, data.Error);
                return null;
            }

            console.log(`${LOG_PREFIX} Found:`, {
                title: data.Title,
                year: data.Year,
                type: data.Type,
                imdbID: data.imdbID,
            });

            return data;
        } catch (error) {
            console.error(`${LOG_PREFIX} Search error:`, error);
            return null;
        }
    }

    /**
     * Search OMDB with fuzzy title matching
     * Uses 's' parameter for search (returns list of matches)
     */
    static async fuzzySearch(
        title: string,
        type?: 'movie' | 'series'
    ): Promise<OMDBResult[]> {
        try {
            const params = new URLSearchParams({
                apikey: OMDB_API_KEY,
                s: title,
            });

            if (type) {
                params.append('type', type);
            }

            const response = await fetch(`${OMDB_API_URL}?${params}`);

            if (!response.ok) return [];

            const data = await response.json();

            if (data.Response === 'False' || !data.Search) {
                return [];
            }

            return data.Search;
        } catch (error) {
            console.error(`${LOG_PREFIX} Fuzzy search error:`, error);
            return [];
        }
    }

    /**
     * Get detailed info by IMDB ID (most accurate)
     */
    static async getByIMDBId(imdbId: string): Promise<OMDBResult | null> {
        try {
            const params = new URLSearchParams({
                apikey: OMDB_API_KEY,
                i: imdbId,
                plot: 'short',
            });

            const response = await fetch(`${OMDB_API_URL}?${params}`);

            if (!response.ok) return null;

            const data: OMDBResult = await response.json();
            return data.Response === 'True' ? data : null;
        } catch (error) {
            console.error(`${LOG_PREFIX} GetByID error:`, error);
            return null;
        }
    }
}
