import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { useSubtitleCueStore } from '../src/store/subtitleCueStore';
import { SubtitleCue } from '../src/types';

describe('useSubtitleCueStore', () => {
    beforeEach(() => {
        useSubtitleCueStore.getState().clearCue();
    });

    it('initializes with null cue', () => {
        expect(useSubtitleCueStore.getState().currentCue).toBeNull();
    });

    it('updates current cue', () => {
        const testCue: SubtitleCue = {
            index: 1,
            startTime: 10,
            endTime: 15,
            text: 'Hello world',
        };
        useSubtitleCueStore.getState().setCurrentCue(testCue);
        expect(useSubtitleCueStore.getState().currentCue).toEqual(testCue);
    });

    it('clears current cue', () => {
        const testCue: SubtitleCue = {
            index: 1,
            startTime: 10,
            endTime: 15,
            text: 'Hello world',
        };
        useSubtitleCueStore.getState().setCurrentCue(testCue);
        expect(useSubtitleCueStore.getState().currentCue).not.toBeNull();

        useSubtitleCueStore.getState().clearCue();
        expect(useSubtitleCueStore.getState().currentCue).toBeNull();
    });

    it('does not trigger state change for identical cue text and start time', () => {
        const cueA: SubtitleCue = {
            index: 1,
            startTime: 10,
            endTime: 15,
            text: 'Same text',
        };
        const cueB: SubtitleCue = {
            index: 1,
            startTime: 10,
            endTime: 16,
            text: 'Same text',
        };

        useSubtitleCueStore.getState().setCurrentCue(cueA);
        const stateBefore = useSubtitleCueStore.getState();

        useSubtitleCueStore.getState().setCurrentCue(cueB);
        const stateAfter = useSubtitleCueStore.getState();

        // State reference should be identical because change was suppressed
        expect(stateBefore).toBe(stateAfter);
    });
});
