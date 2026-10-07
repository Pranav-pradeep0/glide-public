import { describe, expect, it, jest } from '@jest/globals';

// Only the renderer half of SubtitleHtmlParser needs reanimated; cue lookup does not.
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { Text: 'Text' } }));

import { SubtitleParser } from '../src/utils/SubtitleParser';

const cue = (index: number, startTime: number, endTime: number, text: string) =>
    ({ index, startTime, endTime, text });

describe('SubtitleParser.findActiveCue', () => {
    it('shows overlapping cues together, including ones listed out of time order', () => {
        // ASS lists the long sign after the dialogue it overlaps
        const cues = [cue(1, 10, 12, 'Hello'), cue(2, 20, 22, 'Later'), cue(3, 5, 30, 'SIGN')];
        expect(SubtitleParser.findActiveCue(cues, 11)?.text).toBe('Hello\nSIGN');
        expect(SubtitleParser.findActiveCue(cues, 15)?.text).toBe('SIGN');
        expect(SubtitleParser.findActiveCue(cues, 31)).toBeNull();
    });

    it('returns the cue itself when only one is showing', () => {
        const only = cue(1, 0, 2, 'One');
        expect(SubtitleParser.findActiveCue([only], 1)).toBe(only);
    });
});
