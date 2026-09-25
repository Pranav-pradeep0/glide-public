/**
 * Runs SubtitleAutoSync and applies its answer all-or-nothing.
 *
 * - Automatic: once per external subtitle, and only while the delay is untouched (0). An
 *   external .srt is where sync is usually wrong; a delay the user set is never overruled.
 * - Manual: the sync panel's Auto button, any subtitle, always applies a confident answer.
 *
 * An answer is dropped if the subtitle changed while it was being worked out, so a result is
 * never applied to cues it was not computed for.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SubtitleCue } from '@/types';
import { AutoSyncResult, SubtitleAutoSync } from '@/services/SubtitleAutoSync';

interface Options {
    videoPath: string;
    cues: SubtitleCue[];
    isExternal: boolean;
    /** Local files only: a network stream would be fetched twice to analyse it. */
    enabled: boolean;
    currentTimeRef: React.MutableRefObject<number>;
    delayMs: number;
    setDelay: (ms: number) => void;
    showToast: (message: string) => void;
}

/** One line for a result, shared by the toast and the sync panel. */
export function describeAutoSync(result: AutoSyncResult): string {
    switch (result.kind) {
        case 'synced': {
            if (Math.abs(result.delayMs) < 100) {return 'Subtitles are in sync';}
            const s = (result.delayMs / 1000).toFixed(2);
            return `Subtitles synced ${result.delayMs > 0 ? '+' : ''}${s} s`;
        }
        case 'drift': return 'This subtitle was made for a different frame rate. Try another one.';
        case 'unsure': return 'Couldn’t sync confidently here. Try Pick a line.';
        case 'too-few-cues': return 'Not enough dialogue nearby to sync';
        case 'failed': return 'Auto sync failed';
    }
}

export function useSubtitleAutoSync({
    videoPath, cues, isExternal, enabled, currentTimeRef, delayMs, setDelay, showToast,
}: Options) {
    const [running, setRunning] = useState(false);
    const runningRef = useRef(false);
    const cuesRef = useRef(cues);
    cuesRef.current = cues;
    const delayRef = useRef(delayMs);
    delayRef.current = delayMs;

    const run = useCallback(async (manual: boolean): Promise<AutoSyncResult | null> => {
        if (runningRef.current || !enabled || cues.length === 0) {return null;}
        runningRef.current = true;
        setRunning(true);
        const analysed = cues;
        try {
            const result = await SubtitleAutoSync.compute(videoPath, analysed, currentTimeRef.current);
            if (cuesRef.current !== analysed) {return null;}   // subtitle changed meanwhile
            // An automatic answer yields to anything the user set while it ran.
            if (!manual && delayRef.current !== 0) {return null;}
            if (result.kind === 'synced') {setDelay(result.delayMs);}
            // A manual run reports in the sync panel; an automatic one has only the toast.
            if (!manual && (result.kind === 'synced' || result.kind === 'drift')) {
                showToast(describeAutoSync(result));
            }
            return result;
        } finally {
            runningRef.current = false;
            setRunning(false);
        }
    }, [enabled, cues, videoPath, currentTimeRef, setDelay, showToast]);

    const attempted = useRef<SubtitleCue[] | null>(null);
    useEffect(() => {
        if (!enabled || !isExternal || cues.length === 0 || delayMs !== 0) {return;}
        if (attempted.current === cues) {return;}
        attempted.current = cues;
        run(false);
    }, [enabled, isExternal, cues, delayMs, run]);

    return { runAutoSync: () => run(true), autoSyncRunning: running };
}
