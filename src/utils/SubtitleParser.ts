import { SubtitleCue } from '../types';

export class SubtitleParser {
    // Parse SRT format
    static parseSRT(content: string): SubtitleCue[] {
        const cues: SubtitleCue[] = [];
        const blocks = content.trim().split(/\n\s*\n/);

        blocks.forEach((block) => {
            const lines = block.trim().split('\n');
            if (lines.length < 3) { return; }

            const index = parseInt(lines[0], 10);
            const timeMatch = lines[1].match(
                /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
            );

            if (!timeMatch) { return; }

            const startTime =
                parseInt(timeMatch[1], 10) * 3600 +
                parseInt(timeMatch[2], 10) * 60 +
                parseInt(timeMatch[3], 10) +
                parseInt(timeMatch[4], 10) / 1000;

            const endTime =
                parseInt(timeMatch[5], 10) * 3600 +
                parseInt(timeMatch[6], 10) * 60 +
                parseInt(timeMatch[7], 10) +
                parseInt(timeMatch[8], 10) / 1000;

            const text = lines.slice(2).join('\n');
            const soundEffect = SubtitleParser.extractSoundEffect(text);

            cues.push({ index, startTime, endTime, text, soundEffect });
        });

        return cues;
    }

    // Parse WebVTT format
    static parseVTT(content: string): SubtitleCue[] {
        const cues: SubtitleCue[] = [];
        const lines = content.split('\n');
        let index = 0;
        let i = 0;

        // Skip WEBVTT header
        while (i < lines.length && !lines[i].includes('-->')) {
            i++;
        }

        while (i < lines.length) {
            const line = lines[i].trim();

            if (line.includes('-->')) {
                const timeMatch = line.match(
                    /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
                );

                if (timeMatch) {
                    const startTime =
                        parseInt(timeMatch[1], 10) * 3600 +
                        parseInt(timeMatch[2], 10) * 60 +
                        parseInt(timeMatch[3], 10) +
                        parseInt(timeMatch[4], 10) / 1000;

                    const endTime =
                        parseInt(timeMatch[5], 10) * 3600 +
                        parseInt(timeMatch[6], 10) * 60 +
                        parseInt(timeMatch[7], 10) +
                        parseInt(timeMatch[8], 10) / 1000;

                    let text = '';
                    i++;
                    while (i < lines.length && lines[i].trim() !== '') {
                        text += (text ? '\n' : '') + lines[i].trim();
                        i++;
                    }

                    const soundEffect = SubtitleParser.extractSoundEffect(text);
                    cues.push({ index: index++, startTime, endTime, text, soundEffect });
                }
            }
            i++;
        }

        return cues;
    }

    // Parse ASS/SSA format (basic)
    static parseASS(content: string): SubtitleCue[] {
        const cues: SubtitleCue[] = [];
        const lines = content.split('\n');
        let inEvents = false;
        let index = 0;

        for (const line of lines) {
            if (line.trim() === '[Events]') {
                inEvents = true;
                continue;
            }

            if (inEvents && line.startsWith('Dialogue:')) {
                const parts = line.substring(9).split(',');
                if (parts.length < 10) { continue; }

                const startParts = parts[1].trim().split(':');
                const endParts = parts[2].trim().split(':');

                const startTime =
                    parseInt(startParts[0], 10) * 3600 +
                    parseInt(startParts[1], 10) * 60 +
                    parseFloat(startParts[2]);

                const endTime =
                    parseInt(endParts[0], 10) * 3600 +
                    parseInt(endParts[1], 10) * 60 +
                    parseFloat(endParts[2]);

                const text = parts.slice(9).join(',').replace(/\\N/g, '\n').replace(/{[^}]*}/g, '');
                const soundEffect = SubtitleParser.extractSoundEffect(text);

                cues.push({ index: index++, startTime, endTime, text, soundEffect });
            }
        }

        return cues;
    }

    // Auto-detect format and parse
    static parse(content: string, format?: string): SubtitleCue[] {
        if (!content) { return []; }

        // Auto-detect format if not specified
        if (!format) {
            if (content.includes('WEBVTT')) { format = 'vtt'; }
            else if (content.includes('[Script Info]')) { format = 'ass'; }
            else { format = 'srt'; }
        }

        switch (format.toLowerCase()) {
            case 'vtt':
            case 'webvtt':
                return SubtitleParser.parseVTT(content);
            case 'ass':
            case 'ssa':
                return SubtitleParser.parseASS(content);
            case 'srt':
            default:
                return SubtitleParser.parseSRT(content);
        }
    }

    // Find active subtitle at current time
    static findActiveCue(cues: SubtitleCue[], currentTime: number): SubtitleCue | null {
        // Binary search for performance
        let left = 0;
        let right = cues.length - 1;
        let result: SubtitleCue | null = null;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const cue = cues[mid];

            if (currentTime >= cue.startTime && currentTime <= cue.endTime) {
                return cue;
            }

            if (currentTime < cue.startTime) {
                right = mid - 1;
            } else {
                result = cue;
                left = mid + 1;
            }
        }

        // Double-check the result
        if (result && currentTime >= result.startTime && currentTime <= result.endTime) {
            return result;
        }

        return null;
    }

    /**
     * Extracts text inside [brackets] or (parentheses)
     * e.g., "[Explosion]" -> "Explosion"
     */
    private static extractSoundEffect(text: string): string | undefined {
        // Match [Sound]
        const bracketMatch = text.match(/\[(.*?)\]/);
        if (bracketMatch) { return bracketMatch[1]; }

        // Match (Sound) - typically used for speaker names but sometimes sounds
        // We prioritize brackets as they are standard for SDH sound effects
        const parenMatch = text.match(/\((.*?)\)/);
        if (parenMatch) { return parenMatch[1]; }

        return undefined;
    }
}
