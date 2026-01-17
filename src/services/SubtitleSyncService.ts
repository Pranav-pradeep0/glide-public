import { SubtitleCue } from '../types';

export interface MatchResult {
    cue: SubtitleCue;
    score: number;
    matchedText: string;
}

export class SubtitleSyncService {
    private static MAX_WINDOW_MINUTES = 5;
    private static WINDOW_STEPS = [1, 2, 3, 5];

    /**
     * Finds matching cues near the current playback time.
     * Searches in expanding windows to prioritize proximity and avoid duplicates.
     */
    static findMatchingCues(
        cues: SubtitleCue[],
        query: string,
        currentTime: number
    ): MatchResult[] {
        if (!query || query.trim().length < 2) return [];

        const normalizedQuery = this.normalize(query);
        const results: MatchResult[] = [];

        for (const windowMinutes of this.WINDOW_STEPS) {
            const windowSeconds = windowMinutes * 60;
            const startTime = Math.max(0, currentTime - windowSeconds);
            const endTime = currentTime + windowSeconds;

            const windowResults = this.searchInWindow(cues, normalizedQuery, startTime, endTime, currentTime);

            if (windowResults.length > 0) {
                // If we found good matches in a smaller window, we stop here to avoid
                // confusion with similar phrases further away in the movie.
                return windowResults.slice(0, 5);
            }
        }

        return [];
    }

    private static searchInWindow(
        cues: SubtitleCue[],
        normalizedQuery: string,
        startTime: number,
        endTime: number,
        currentTime: number
    ): MatchResult[] {
        const matches: MatchResult[] = [];

        // Find cues within the time window
        const relevantCues = cues.filter(c =>
            (c.startTime >= startTime && c.startTime <= endTime) ||
            (c.endTime >= startTime && c.endTime <= endTime)
        );

        for (const cue of relevantCues) {
            const normalizedCueText = this.normalize(cue.text);
            const score = this.calculateScore(normalizedCueText, normalizedQuery, cue, currentTime);

            if (score > 0) {
                matches.push({
                    cue,
                    score,
                    matchedText: cue.text
                });
            }
        }

        // Sort by score (descending) and then proximity to current time
        return matches.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return Math.abs(a.cue.startTime - currentTime) - Math.abs(b.cue.startTime - currentTime);
        });
    }

    private static normalize(text: string): string {
        return text
            .toLowerCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    private static calculateScore(cueText: string, query: string, cue: SubtitleCue, currentTime: number): number {
        if (cueText.includes(query)) {
            // Exact match gets high base score
            let score = 100;

            // Check if it's an exact word match (not just substring)
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedQuery}\\b`, 'i');
            if (regex.test(cueText)) score += 50;

            // Proximity bonus (closer to currentTime = higher bonus)
            const timeDiff = Math.abs(cue.startTime - currentTime);
            const proximityBonus = Math.max(0, 50 - (timeDiff / 2)); // Bonus decreases as time diff increases

            return score + proximityBonus;
        }

        // Fuzzy match for individual words if query has multiple words
        const queryWords = query.split(' ').filter(w => w.length > 2);
        if (queryWords.length > 1) {
            let matches = 0;
            for (const word of queryWords) {
                if (cueText.includes(word)) matches++;
            }
            if (matches >= queryWords.length / 2) {
                return (matches / queryWords.length) * 80;
            }
        }

        return 0;
    }

    /**
     * Calculates the offset in milliseconds to sync the cue to the current time.
     */
    static calculateOffset(cue: SubtitleCue, currentTime: number): number {
        // If cue is at 10s and we are at 12s, we need a 2s delay.
        // VLC/System delay usually works such that positive = delay subtitles (show later).
        // offset = currentTime - cueStartTime
        return Math.round((currentTime - cue.startTime) * 1000);
    }
}
