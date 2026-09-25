import { describe, expect, it, jest } from '@jest/globals';

// The FFmpeg-backed extractor is native; these tests cover the decisions around it.
jest.mock('../src/utils/AudioExtractor', () => ({ AudioExtractor: {} }));

import { chooseWindow, interpret, isSpeechCue, WINDOW_S } from '../src/services/SubtitleAutoSync';
import { SubtitleCue } from '../src/types';

const cue = (startTime: number, endTime: number, text = 'Where are you going?', index = 0): SubtitleCue =>
    ({ index, startTime, endTime, text });

/** A speech cue every [every] seconds from [from] to [to]. */
const dialogue = (from: number, to: number, every = 4) =>
    Array.from({ length: Math.floor((to - from) / every) }, (_, i) => cue(from + i * every, from + i * every + 2));

describe('isSpeechCue', () => {
    it('keeps spoken lines in any script', () => {
        expect(isSpeechCue(cue(0, 2, 'I told you.'))).toBe(true);
        expect(isSpeechCue(cue(0, 2, 'तुम कहाँ जा रहे हो?'))).toBe(true);
        expect(isSpeechCue(cue(0, 2, '<i>Hello</i>'))).toBe(true);
        expect(isSpeechCue(cue(0, 2, '[door slams] Get out!'))).toBe(true);
    });

    it('drops sound descriptions, lyrics and held captions, which are on screen while nobody talks', () => {
        expect(isSpeechCue(cue(0, 2, '[door slams]'))).toBe(false);
        expect(isSpeechCue(cue(0, 2, '(PHONE RINGING)'))).toBe(false);
        expect(isSpeechCue(cue(0, 3, '♪ Hallelujah ♪'))).toBe(false);
        expect(isSpeechCue(cue(0, 2, '...'))).toBe(false);
        expect(isSpeechCue(cue(0, 30, 'LONDON, 1943'))).toBe(false);
        expect(isSpeechCue(cue(5, 5, 'Zero length'))).toBe(false);
    });
});

describe('chooseWindow', () => {
    it('picks the densest dialogue near the viewer', () => {
        // Sparse dialogue, then a dense scene from 1200 s.
        const cues = [...dialogue(0, 1200, 30), ...dialogue(1200, 1800, 3)];
        const start = chooseWindow(cues, 1000)!;
        expect(start).toBeGreaterThanOrEqual(1150);
        expect(start + WINDOW_S).toBeLessThanOrEqual(1800 + 20);
    });

    it('stays near the viewer, since an edit can change sync mid-film', () => {
        const cues = [...dialogue(0, 600, 3), ...dialogue(4000, 4600, 3)];
        expect(chooseWindow(cues, 4300)!).toBeGreaterThan(3000);
    });

    it('refuses when there is too little dialogue to align', () => {
        expect(chooseWindow(dialogue(0, 600, 60), 100)).toBeNull();
        expect(chooseWindow([], 0)).toBeNull();
    });
});

describe('interpret', () => {
    const base = { delayMs: 1834, ratio: 1, peakZ: 12, runnerUp: 0.3, confident: true, drift: false };

    it('applies a confident plain delay, rounded to the 10 ms the panel works in', () => {
        expect(interpret(base)).toEqual({ kind: 'synced', delayMs: 1830 });
    });

    it('never applies an unsure or drifting answer', () => {
        expect(interpret({ ...base, confident: false })).toEqual({ kind: 'unsure' });
        expect(interpret({ ...base, drift: true, ratio: 25 / 23.976 })).toEqual({ kind: 'drift' });
        expect(interpret(null)).toEqual({ kind: 'unsure' });
    });
});
