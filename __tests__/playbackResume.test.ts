import { describe, expect, it } from '@jest/globals';
import { getResumablePosition } from '../src/utils/playbackResume';

describe('getResumablePosition', () => {
    it('keeps a position safely inside the media', () => {
        expect(getResumablePosition(42, 120)).toBe(42);
    });

    it.each([null, undefined, 0, 1, -1])('rejects an opening position: %s', position => {
        expect(getResumablePosition(position, 120)).toBeNull();
    });

    it.each([119, 120, 121])('rejects a completed position: %s', position => {
        expect(getResumablePosition(position, 120)).toBeNull();
    });

    it('rejects invalid durations and non-finite values', () => {
        expect(getResumablePosition(42, 0)).toBeNull();
        expect(getResumablePosition(42, Number.NaN)).toBeNull();
        expect(getResumablePosition(Number.POSITIVE_INFINITY, 120)).toBeNull();
    });
});
