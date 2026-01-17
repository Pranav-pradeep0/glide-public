import { HAPTIC_KEYWORDS } from '../data/hapticKeywords';
import { HapticMatch } from '../types/hapticTypes';

export class SmartKeywordMatcher {
    /**
     * Contexts where specific keywords should be IGNORED.
     * key: keyword to block
     * value: list of phrases/words that, if present in the text, invalidate the match
     */
    private static readonly BLACKLIST_CONTEXT: Record<string, string[]> = {
        'pop': ['music', 'song', 'culture', 'radio', 'cork'],
        'break': ['voice', 'heart', 'record', 'promise', 'wind'],
        'crack': ['joke', 'smile', 'voice'],
        'beat': ['music', 'song', 'rhythm'],
        'engine': ['humming', 'person', 'voice'],
        'punch': ['line'],
    };

    /**
     * Matches a sound effect description to a haptic keyword
     * @param text The sound effect text (e.g., "Loud explosion", "Footsteps approaching")
     * @returns The best matching haptic category and keyword, or null if no match
     */
    static match(text: string): HapticMatch | null {
        if (!text) return null;

        const normalizedText = text.toLowerCase().trim();
        // Split by anything that isn't a letter or number (punctuation, spaces, etc.)
        const words = normalizedText.split(/[^a-z0-9]+/);

        let bestMatch: HapticMatch | null = null;

        for (const entry of HAPTIC_KEYWORDS) {
            // CHECK BLACKLIST FIRST
            if (this.BLACKLIST_CONTEXT[entry.keyword]) {
                const ignoredTerms = this.BLACKLIST_CONTEXT[entry.keyword];
                if (ignoredTerms.some(term => normalizedText.includes(term))) {
                    continue; // Skip this keyword if context matches blacklist
                }
            }

            // Check main keyword
            if (this.isMatch(normalizedText, words, entry.keyword)) {
                const match: HapticMatch = {
                    keyword: entry.keyword,
                    category: entry.category,
                    priority: entry.priority,
                    confidence: 1.0
                };

                // Keep the highest priority match
                if (!bestMatch || match.priority > bestMatch.priority) {
                    bestMatch = match;
                }
                continue;
            }

            // Check variations
            if (entry.variations) {
                for (const variation of entry.variations) {
                    if (this.isMatch(normalizedText, words, variation)) {
                        const match: HapticMatch = {
                            keyword: entry.keyword, // Use the canonical keyword
                            category: entry.category,
                            priority: entry.priority,
                            confidence: 0.9
                        };

                        if (!bestMatch || match.priority > bestMatch.priority) {
                            bestMatch = match;
                        }
                    }
                }
            }
        }

        return bestMatch;
    }

    /**
     * Checks if a keyword matches the text, handling plurals and verb forms
     */
    private static isMatch(fullText: string, words: string[], keyword: string): boolean {
        // 1. Strict Word Boundary Check (Prevents "chitters" matching "hit")
        // Escaping keyword for regex safety
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');

        if (regex.test(fullText)) return true;

        // 2. Check each word for variations (stems)
        for (const word of words) {
            // Exact match (covered by regex, but kept for safety/perf)
            if (word === keyword) return true;

            // Plural handling (footsteps -> footstep)
            if (word === keyword + 's') return true;
            if (word === keyword + 'es') return true;

            // Verb forms (growling -> growl, growled -> growl)
            if (word.endsWith('ing') && word.slice(0, -3) === keyword) return true;
            if (word.endsWith('ing') && word.slice(0, -3) === keyword.slice(0, -1)) return true; // runn-ing -> run
            if (word.endsWith('ed') && word.slice(0, -2) === keyword) return true;
        }

        return false;
    }
}
