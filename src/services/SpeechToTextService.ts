// src/services/SpeechToTextService.ts

import { GROQ_API_KEY, GROQ_API_URL } from '../utils/constants';

const LOG_PREFIX = '[SpeechToTextService]';

export interface TranscriptionResponse {
    text: string;
}

export interface TranscribeOptions {
    language?: string; // ISO-639-1 code (e.g. 'en', 'es', 'hi')
    task?: 'transcribe' | 'translate';
}

export class SpeechToTextService {
    /**
     * Transcribes an audio file using Groq Whisper API
     * @param audioPath Absolute path to the local audio file (.m4a)
     * @param options Configuration for transcription (language, task)
     * @returns Transcribed text
     */
    static async transcribe(audioPath: string, options: TranscribeOptions = {}): Promise<string> {
        if (__DEV__) {console.log(`${LOG_PREFIX} Starting transcription for: ${audioPath}`, options);}

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

            // Apply options
            let apiUrl = GROQ_API_URL;

            if (options.task === 'translate') {
                // Switch to translations endpoint
                apiUrl = GROQ_API_URL.replace('/transcriptions', '/translations');
            } else if (options.language) {
                // Whisper expects ISO-639-1 code
                formData.append('language', options.language);
            }

            const response = await fetch(apiUrl, {
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
            if (__DEV__) {console.log(`${LOG_PREFIX} Transcription complete: "${data.text.substring(0, 50)}..."`);}

            return data.text.trim();
        } catch (error) {
            console.error(`${LOG_PREFIX} Transcription failed:`, error);
            throw error;
        }
    }
}


