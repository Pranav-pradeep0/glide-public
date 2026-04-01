import axios from 'axios';
import { SubtitleCue } from '../types';
import { GROQ_API_KEY, GROQ_CHAT_API_URL } from '../utils/constants';
import { SubtitleCueStore } from './SubtitleCueStore';
import { SubtitleTrack } from '../utils/SubtitleExtractor';

export class RecapService {
    private static readonly MIN_DIALOGUE_LINES = 4;
    private static readonly MIN_DIALOGUE_WORDS = 40;
    private static readonly MIN_DIALOGUE_DURATION_SECONDS = 12;

    /**
     * High-level entry point to get dialogue for recap.
     * Checks existing cues first, then uses SubtitleCueStore to find/extract the best track.
     */
    static async getDialogueForRecap(
        videoPath: string,
        tracks: SubtitleTrack[],
        existingCues: SubtitleCue[],
        resumePosition: number,
        _videoTitle?: string
    ): Promise<string | null> {
        const cues = await this.getCuesForRecap(videoPath, tracks, existingCues);

        if (!cues || cues.length === 0) {
            if (__DEV__) { console.warn('[RecapService] No subtitles available for recap'); }
            return null;
        }

        const stats = this.getRecentDialogueStats(cues, resumePosition);
        if (!stats || !this.isDialogueSufficient(stats)) {
            if (__DEV__) { console.warn('[RecapService] Not enough dialogue for recap'); }
            return null;
        }

        return stats.dialogue;
    }

    /**
     * Extracts dialogue from the last few minutes (e.g., 5 mins) before the resume position.
     * Balanced for quality and token usage.
     */
    static getRecentDialogue(cues: SubtitleCue[], resumePosition: number, windowSeconds: number = 300): string {
        const stats = this.getRecentDialogueStats(cues, resumePosition, windowSeconds);
        return stats?.dialogue || '';
    }

    static async getRecapEligibility(
        videoPath: string,
        tracks: SubtitleTrack[],
        existingCues: SubtitleCue[],
        resumePosition: number
    ): Promise<{ eligible: boolean; reason: 'no_subtitles' | 'insufficient_dialogue' | 'ok' }> {
        const cues = await this.getCuesForRecap(videoPath, tracks, existingCues);
        if (!cues || cues.length === 0) {
            return { eligible: false, reason: 'no_subtitles' };
        }

        const stats = this.getRecentDialogueStats(cues, resumePosition);
        if (!stats || !this.isDialogueSufficient(stats)) {
            return { eligible: false, reason: 'insufficient_dialogue' };
        }

        return { eligible: true, reason: 'ok' };
    }

    private static async getCuesForRecap(
        videoPath: string,
        tracks: SubtitleTrack[],
        existingCues: SubtitleCue[]
    ): Promise<SubtitleCue[] | null> {
        let cues = existingCues;

        // If no cues currently enabled, find the best track and extract
        if (!cues || cues.length === 0) {
            if (__DEV__) { console.log('[RecapService] No active cues, searching for best track...'); }
            const result = await SubtitleCueStore.getBestTrackCues(videoPath, tracks);
            if (result) {
                if (__DEV__) { console.log('[RecapService] Using track:', result.trackIndex); }
                cues = result.cues;
            }
        }

        return cues && cues.length > 0 ? cues : null;
    }

    private static getRecentDialogueStats(
        cues: SubtitleCue[],
        resumePosition: number,
        windowSeconds: number = 300
    ): { dialogue: string; lineCount: number; wordCount: number; durationSeconds: number } | null {
        const startTime = Math.max(0, resumePosition - windowSeconds);
        const relevantCues = cues.filter(
            cue => cue.startTime >= startTime && cue.startTime <= resumePosition
        );

        if (relevantCues.length === 0) { return null; }

        let lineCount = 0;
        let wordCount = 0;
        let durationSeconds = 0;
        const processedCues: string[] = [];

        for (const cue of relevantCues) {
            // Remove HTML-like tags
            let text = cue.text.replace(/<[^>]*>/g, '');
            // Remove bracketed noise like [MUSIC], (SIGHS), [Door Slams]
            text = text.replace(/\[[^\]]*\]|\([^)]*\)/g, '');
            text = text.trim();

            if (!text) { continue; }

            processedCues.push(text);
            lineCount += 1;
            durationSeconds += Math.max(0, cue.endTime - cue.startTime);
            wordCount += text.split(/\s+/).filter(Boolean).length;
        }

        if (processedCues.length === 0) { return null; }

        let dialogue = processedCues.join(' ');

        // Limit to roughly 1000-1200 tokens (~5000 characters)
        // We take the LATEST part if it's too long, but try to cut at a sentence boundary
        if (dialogue.length > 5000) {
            const truncated = dialogue.substring(dialogue.length - 5000);
            // Find first space to avoid cutting a word
            const firstSpace = truncated.indexOf(' ');
            dialogue = firstSpace !== -1 ? truncated.substring(firstSpace).trim() : truncated;
        }

        return { dialogue, lineCount, wordCount, durationSeconds };
    }

    private static isDialogueSufficient(stats: { lineCount: number; wordCount: number; durationSeconds: number }): boolean {
        return (
            stats.lineCount >= this.MIN_DIALOGUE_LINES &&
            stats.wordCount >= this.MIN_DIALOGUE_WORDS &&
            stats.durationSeconds >= this.MIN_DIALOGUE_DURATION_SECONDS
        );
    }

    /**
     * Summarizes the dialogue using Groq Llama 3.
     */
    static async generateRecap(dialogue: string, videoTitle?: string): Promise<string | null> {
        if (!dialogue) {
            console.warn('[RecapService] No dialogue provided');
            return null;
        }

        if (!GROQ_API_KEY) {
            console.error('[RecapService] GROQ_API_KEY is not configured. Please add it to your .env file.');
            return null;
        }

        try {
            const contextInput = videoTitle ? `Movie/Show Title: "${videoTitle}"\n\n` : '';

            const response = await axios.post(
                GROQ_CHAT_API_URL,
                {
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a cinematic recap expert. Your task is to provide a "Previously on..." style recap based on provided dialogue.

GUIDELINES:
- Context: Use the movie/show title (if provided) to ground your recap and name characters if they appear in the text.
- Tone: Dramatic, cinematic, and engaging. 
- Length: Concise, exactly 2-3 sentences.
- Focus: Highlight major plot beats, emotional shifts, or impending conflicts. 
- Sparse Scenes: If the dialogue is generic, summarize the vibe or situation (e.g., "Tensions rise as the group faces an uncertain future").
- No Meta: Do not mention being an AI or say "Based on the dialogue."`,
                        },
                        {
                            role: 'user',
                            content: `${contextInput}Dialogue from the last few minutes:\n"${dialogue}"`,
                        },
                    ],
                    temperature: 0.7,
                    max_tokens: 150,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${GROQ_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 15000, // 15s timeout for slower networks
                }
            );

            const recap = response.data.choices[0]?.message?.content?.trim();
            return recap || null;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response) {
                    // Server responded with error status
                    console.error('[RecapService] API Error:', error.response.status, error.response.data);
                } else if (error.request) {
                    // Request was made but no response received (network error)
                    console.error('[RecapService] Network Error: No response from server. Check internet connection.');
                } else {
                    // Error setting up the request
                    console.error('[RecapService] Request Error:', error.message);
                }
            } else {
                console.error('[RecapService] Unexpected Error:', error);
            }
            return null;
        }
    }
}

