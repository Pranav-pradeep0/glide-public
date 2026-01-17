// src/services/SpeechToTextService.ts

import { GROQ_API_KEY, GROQ_API_URL } from '../utils/constants';

const LOG_PREFIX = '[SpeechToTextService]';

export interface TranscriptionResponse {
    text: string;
}

export class SpeechToTextService {
    /**
     * Transcribes an audio file using Groq Whisper API
     * @param audioPath Absolute path to the local audio file (.m4a)
     * @returns Transcribed text
     */
    static async transcribe(audioPath: string): Promise<string> {
        console.log(`${LOG_PREFIX} Starting transcription for: ${audioPath}`);

        try {
            const formData = new FormData();

            // Create the file object for FormData
            // In React Native, we use an object with uri, name, and type
            formData.append('file', {
                uri: `file://${audioPath}`,
                name: 'audio.wav',
                type: 'audio/wav',
            } as any);

            formData.append('model', 'whisper-large-v3');
            formData.append('response_format', 'json');
            // Omit language for auto-detection

            const response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Accept': 'application/json',
                },
                body: formData,
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`${LOG_PREFIX} API Error (${response.status}):`, errorText);
                throw new Error(`Groq API error: ${response.status} ${errorText}`);
            }

            const data: TranscriptionResponse = await response.json();
            console.log(`${LOG_PREFIX} Transcription complete: "${data.text.substring(0, 50)}..."`);

            return data.text.trim();
        } catch (error) {
            console.error(`${LOG_PREFIX} Transcription failed:`, error);
            throw error;
        }
    }
}
