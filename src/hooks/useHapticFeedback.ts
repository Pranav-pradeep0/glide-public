import { useEffect, useRef } from 'react';
import { SubtitleCue } from '../types';
import { HapticEngineService } from '../services/HapticEngineService';
import { HapticPatternGenerator } from '../services/HapticPatternGenerator';

interface UseHapticFeedbackProps {
    enabled: boolean;
    currentTime: number;
    subtitleCues: SubtitleCue[];
    isPlaying: boolean;
    subtitleDelay?: number; // in milliseconds
}

export function useHapticFeedback({
    enabled,
    currentTime,
    subtitleCues,
    isPlaying,
    subtitleDelay = 0
}: UseHapticFeedbackProps) {
    const lastProcessedCueIndex = useRef<number>(-1);
    const engine = HapticEngineService.getInstance();

    // Enable/Disable engine
    useEffect(() => {
        engine.setEnabled(enabled);
    }, [enabled]);

    // Main loop
    useEffect(() => {
        if (!enabled || !isPlaying || subtitleCues.length === 0) {
            return;
        }

        // Find active cue
        // Apply subtitle delay offset (convert ms to seconds)
        const effectiveTime = currentTime - (subtitleDelay / 1000);

        // We use a slightly wider window to catch cues that might have just started
        const activeCue = subtitleCues.find(cue =>
            effectiveTime >= cue.startTime &&
            effectiveTime <= cue.startTime + 0.5 // Check within 500ms of start
        );

        if (activeCue) {
            // Avoid re-triggering the same cue
            if (lastProcessedCueIndex.current === activeCue.index) {
                return;
            }

            // Generate pattern
            const pattern = HapticPatternGenerator.generateFromCue(activeCue);

            if (pattern) {
                if (__DEV__) {
                    console.log(`[Haptic] Triggering: ${pattern.soundEffect} (${pattern.category})`);
                }
                engine.triggerHaptic(pattern);
                lastProcessedCueIndex.current = activeCue.index;
            }
        }
    }, [currentTime, enabled, isPlaying, subtitleCues, subtitleDelay]);

    // Debug: Log all detected haptics when subtitles load
    useEffect(() => {
        if (subtitleCues.length > 0) {
            HapticPatternGenerator.debugScanAllCues(subtitleCues);
        }
    }, [subtitleCues]);

    // Reset on seek (if currentTime jumps significantly)
    // This is a bit tricky with just currentTime prop, but the engine handles priority

    return {};
}
