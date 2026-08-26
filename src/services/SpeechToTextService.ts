// src/services/SpeechToTextService.ts

import { AI_PROXY_URL, RECAP_STT_AVAILABLE } from '../utils/constants';
import { fetchWithTimeout } from '../utils/network';

const LOG_PREFIX = '[SpeechToTextService]';
const TRANSCRIBE_TIMEOUT_MS = 30000;

export interface TranscriptionResponse {
    text: string;
}

export interface TranscribeOptions {
    language?: string;
    task?: 'transcribe' | 'translate';
}

export class SpeechToTextService {
    static async transcribe(audioPath: string, options: TranscribeOptions = {}): Promise<string> {
        if (!RECAP_STT_AVAILABLE) {
            throw new Error('Speech-to-text is not available in this build.');
        }

        if (__DEV__) {console.log(`${LOG_PREFIX} Starting transcription`, options);}

        const formData = new FormData();

        formData.append('file', {
            uri: `file://${audioPath}`,
            name: 'audio.wav',
            type: 'audio/wav',
        } as any);
        formData.append('task', options.task ?? 'transcribe');
        if (options.language) {
            formData.append('language', options.language);
        }

        const response = await fetchWithTimeout(
            `${AI_PROXY_URL}/v1/transcribe`,
            {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                },
                body: formData,
            },
            TRANSCRIBE_TIMEOUT_MS
        );

        if (!response.ok) {
            // Status only; never log audio or response bodies.
            if (__DEV__) {console.warn(`${LOG_PREFIX} Proxy error ${response.status}`);}
            if (response.status === 413) {
                throw new Error('Audio clip is too large.');
            }
            if (response.status === 429) {
                throw new Error('Too many requests. Please wait a moment and try again.');
            }
            if (response.status === 502 || response.status === 504) {
                throw new Error('Transcription service is unavailable right now.');
            }
            throw new Error(`Transcription failed (${response.status}).`);
        }

        const data: TranscriptionResponse = await response.json();
        return data.text.trim();
    }
}
