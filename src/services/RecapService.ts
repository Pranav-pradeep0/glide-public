import axios from 'axios';
import { SubtitleCue } from '../types';
import { GROQ_API_KEY, GROQ_CHAT_API_URL } from '../utils/constants';

export class RecapService {
    /**
     * Extracts dialogue from the last few minutes (e.g., 5 mins) before the resume position.
     * Balanced for quality and token usage.
     */
    static getRecentDialogue(cues: SubtitleCue[], resumePosition: number, windowSeconds: number = 300): string {
        const startTime = Math.max(0, resumePosition - windowSeconds);
        const relevantCues = cues.filter(
            cue => cue.startTime >= startTime && cue.startTime <= resumePosition
        );

        if (relevantCues.length === 0) return '';

        // Clean and prepare dialogue
        const processedCues = relevantCues
            .map(cue => {
                // Remove HTML-like tags
                let text = cue.text.replace(/<[^>]*>/g, '');
                // Remove bracketed noise like [MUSIC], (SIGHS), [Door Slams]
                text = text.replace(/\[[^\]]*\]|\([^)]*\)/g, '');
                return text.trim();
            })
            .filter(text => text.length > 0);

        // Join dialogue
        let dialogue = processedCues.join(' ');

        // Limit to roughly 1000-1200 tokens (~5000 characters)
        // We take the LATEST part if it's too long, but try to cut at a sentence boundary
        if (dialogue.length > 5000) {
            const truncated = dialogue.substring(dialogue.length - 5000);
            // Find first space to avoid cutting a word
            const firstSpace = truncated.indexOf(' ');
            dialogue = firstSpace !== -1 ? truncated.substring(firstSpace).trim() : truncated;
        }

        return dialogue;
    }

    /**
     * Summarizes the dialogue using Groq Llama 3.
     */
    static async generateRecap(dialogue: string, videoTitle?: string): Promise<string | null> {
        if (!dialogue || !GROQ_API_KEY) return null;

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
- No Meta: Do not mention being an AI or say "Based on the dialogue."`
                        },
                        {
                            role: 'user',
                            content: `${contextInput}Dialogue from the last few minutes:\n"${dialogue}"`
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 150,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${GROQ_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 10000, // 10s timeout
                }
            );

            const recap = response.data.choices[0]?.message?.content?.trim();
            return recap || null;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[RecapService] API Error:', error.response?.status, error.response?.data);
            } else {
                console.error('[RecapService] Unexpected Error:', error);
            }
            return null;
        }
    }
}
