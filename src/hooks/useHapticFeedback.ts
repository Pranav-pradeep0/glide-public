import { MutableRefObject, useEffect, useRef } from 'react';
import { SubtitleCue } from '../types';
import { HapticEngineService } from '../services/HapticEngineService';
import { HapticPatternGenerator } from '../services/HapticPatternGenerator';

interface UseHapticFeedbackProps {
    enabled: boolean;
    currentTimeRef: MutableRefObject<number>;
    subtitleCues: SubtitleCue[];
    isPlaying: boolean;
    subtitleDelay?: number; // in milliseconds
}

export function useHapticFeedback({
    enabled,
    currentTimeRef,
    subtitleCues,
    isPlaying,
    subtitleDelay = 0,
}: UseHapticFeedbackProps) {
    const lastProcessedCueIndex = useRef<number>(-1);
    const lastEffectiveTimeRef = useRef<number>(0);
    const cueCursorRef = useRef<number>(0);
    const engine = HapticEngineService.getInstance();

    // Enable/Disable engine
    useEffect(() => {
        engine.setEnabled(enabled);
    }, [enabled, engine]);

    useEffect(() => {
        if (!enabled || !isPlaying || subtitleCues.length === 0) {
            return;
        }

        const findNextCue = (effectiveTime: number): SubtitleCue | null => {
            let cursor = cueCursorRef.current;

            if (
                cursor >= subtitleCues.length ||
                (cursor > 0 && effectiveTime < subtitleCues[cursor - 1].startTime)
            ) {
                cursor = lowerBoundCue(subtitleCues, effectiveTime);
            }

            while (
                cursor < subtitleCues.length &&
                effectiveTime > subtitleCues[cursor].startTime + 0.5
            ) {
                cursor++;
            }

            cueCursorRef.current = cursor;

            for (let i = Math.max(0, cursor - 1); i < Math.min(subtitleCues.length, cursor + 3); i++) {
                const cue = subtitleCues[i];
                if (effectiveTime >= cue.startTime && effectiveTime <= cue.startTime + 0.5) {
                    return cue;
                }
            }

            return null;
        };

        const intervalId = setInterval(() => {
            const effectiveTime = currentTimeRef.current - (subtitleDelay / 1000);

            if (Math.abs(effectiveTime - lastEffectiveTimeRef.current) > 2) {
                cueCursorRef.current = lowerBoundCue(subtitleCues, effectiveTime);
                lastProcessedCueIndex.current = -1;
            }
            lastEffectiveTimeRef.current = effectiveTime;

            const activeCue = findNextCue(effectiveTime);

            if (!activeCue || lastProcessedCueIndex.current === activeCue.index) {
                return;
            }

            const pattern = HapticPatternGenerator.generateFromCue(activeCue);
            lastProcessedCueIndex.current = activeCue.index;

            if (!pattern) {
                return;
            }

            if (__DEV__) {console.log(`[Haptic] Triggering: ${pattern.soundEffect} (${pattern.category})`);}
            engine.triggerHaptic(pattern);
        }, 125);

        return () => clearInterval(intervalId);
    }, [currentTimeRef, enabled, engine, isPlaying, subtitleCues, subtitleDelay]);

    useEffect(() => {
        cueCursorRef.current = 0;
        lastEffectiveTimeRef.current = 0;
        lastProcessedCueIndex.current = -1;
    }, [subtitleCues]);

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

function lowerBoundCue(cues: SubtitleCue[], time: number): number {
    let left = 0;
    let right = cues.length;

    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (cues[mid].startTime < time) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }

    return left;
}

