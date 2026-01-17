import { SubtitleCue, HapticSettings } from '../types';
import { HapticPattern, HapticKeyword } from '../types/hapticTypes';
import { SmartKeywordMatcher } from './SmartKeywordMatcher';
import { HapticIntensityCalculator } from './HapticIntensityCalculator';
import { HAPTIC_KEYWORDS } from '../data/hapticKeywords';
import { ContextAnalyzer } from './ContextAnalyzer';
import { HapticSynthesizer } from './HapticSynthesizer';
import { useAppStore } from '../store/appStore';

export class HapticPatternGenerator {
    /**
     * Generates a haptic pattern from a subtitle cue using Hybrid AI/DSP Engine
     */
    static generateFromCue(cue: SubtitleCue): HapticPattern | null {
        // 1. Extract sound effect text
        const soundEffectText = this.extractSoundEffect(cue.text);
        if (!soundEffectText) return null;

        // 2. Match keyword using Smart Matcher
        const match = SmartKeywordMatcher.match(soundEffectText);
        if (!match) return null;

        // 3. Find full keyword data (including Base Profile)
        const keywordData = HAPTIC_KEYWORDS.find(k => k.keyword === match.keyword);
        if (!keywordData || !keywordData.baseProfile) {
            // Fallback for keywords without profiles (or use a default profile based on category)
            // For now, we return null, or we could define defaults.
            // Given we updated most common ones, this is acceptable for MVP.
            console.warn(`[Haptic] No profile for ${match.keyword}`);
            return null;
        }

        // 4. Analyze Context (AI Layer)
        // Detects "Heavy", "Fast", "Shaky", and Sentiment
        const context = ContextAnalyzer.analyze(soundEffectText, match.keyword);

        // 5. Calculate Duration
        const rawDuration = (cue.endTime - cue.startTime) * 1000;
        const duration = Math.max(50, Math.min(rawDuration, 3000));

        // 6. Synthesize Waveform (DSP Layer)
        // Generates real-time audio-like vibration track
        const waveform = HapticSynthesizer.synthesize(
            keywordData.baseProfile,
            context,
            duration
        );

        // 7. Apply User Intensity Global Settings
        // We do this as a final pass to respect user's "global volume" for haptics
        const hapticSettings = useAppStore.getState().settings.hapticSettings;
        waveform.amplitudes = HapticIntensityCalculator.scaleWaveformAmplitudes(
            waveform.amplitudes,
            hapticSettings
        );

        return {
            id: `haptic_${cue.index}_${Date.now()}`,
            category: match.category,
            soundEffect: match.keyword,
            duration: duration,
            intensity: Math.max(...waveform.amplitudes), // Peak intensity
            priority: match.priority + (context.sentimentScore < -2 ? 2 : 0), // Boost priority for tense scenes
            waveform: {
                timings: waveform.timings,
                amplitudes: waveform.amplitudes,
                baseIntensity: keywordData.baseProfile.baseIntensity
            }
        };
    }

    /**
     * Extracts text inside [brackets], (parentheses), or {braces}
     * Scans *all* bracketed groups to find the one containing a valid haptic keyword.
     */
    private static extractSoundEffect(text: string): string | null {
        // Global regex to find all occurrences
        const regex = /[\[\(\{](.*?)[\]\}\)]/g;
        let match;

        let bestCandidate: string | null = null;
        let bestPriority = -1;

        while ((match = regex.exec(text)) !== null) {
            const content = match[1].trim();

            // 1. Basic filtering
            if (content.length <= 1 || !isNaN(Number(content))) {
                continue;
            }

            // 2. Check if this content actually matches a known keyword
            // This prevents "(Man)" from blocking "[Explosion]"
            const keywordMatch = SmartKeywordMatcher.match(content);
            if (keywordMatch) {
                // If we found a valid haptic keyword, use it!
                // We keep the highest priority one if multiple exist
                if (keywordMatch.priority > bestPriority) {
                    bestPriority = keywordMatch.priority;
                    bestCandidate = content;
                }
            }
        }

        return bestCandidate;
    }
    /**
     * Debug Helper: Scans all cues and logs detected haptics to console.
     * Useful for verifying extraction logic across a full movie.
     */
    static debugScanAllCues(cues: SubtitleCue[]) {
        if (!__DEV__) return;

        console.log(`--- [Haptic] Scanning ${cues.length} Subtitles ---`);
        let count = 0;

        // Debug: Print first 5 cues raw to check for HTML/formatting issues
        cues.slice(0, 5).forEach((c, i) => console.log(`[RawCue ${i}]: "${c.text}"`));

        cues.forEach(cue => {
            // Clean HTML tags first! (New hypothesis: <i> tags breaking regex)
            const cleanText = cue.text.replace(/<[^>]*>/g, '');
            const soundEffectText = this.extractSoundEffect(cleanText);

            if (soundEffectText) {
                const match = SmartKeywordMatcher.match(soundEffectText);
                if (match) {
                    count++;
                    // Basic timestamp formatting
                    const seconds = Math.floor(cue.startTime);
                    const h = Math.floor(seconds / 3600);
                    const m = Math.floor((seconds % 3600) / 60);
                    const s = seconds % 60;
                    const timestamp = `${h > 0 ? h + ':' : ''}${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;

                    console.log(`[${timestamp}] "${cue.text}" -> Detected: ${match.keyword.toUpperCase()} (${match.category})`);
                }
            }
        });
        console.log(`--- [Haptic] Scan Complete. Found ${count} haptic events. ---`);
    }
}
