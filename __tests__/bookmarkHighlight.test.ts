import { describe, expect, it } from '@jest/globals';
import {
  BOOKMARK_ACTIVE_WINDOW_SECONDS,
  findActiveBookmarkId,
} from '../src/hooks/video-player/types';

// Bookmark highlighting used to come from a React state update that ran twice a second
// and re-rendered the whole player screen. It now runs on the UI thread against the
// shared playback position, so this decision has to hold on its own.

const timeline = [
  { id: 'a', timestamp: 10 },
  { id: 'b', timestamp: 30 },
  { id: 'c', timestamp: 31 },
];

describe('findActiveBookmarkId', () => {
  it('returns nothing when the playhead is far from every bookmark', () => {
    expect(findActiveBookmarkId(timeline, 0)).toBeNull();
    expect(findActiveBookmarkId(timeline, 20)).toBeNull();
    expect(findActiveBookmarkId(timeline, 500)).toBeNull();
  });

  it('matches a bookmark inside the active window on either side', () => {
    expect(findActiveBookmarkId(timeline, 10)).toBe('a');
    expect(findActiveBookmarkId(timeline, 10 - (BOOKMARK_ACTIVE_WINDOW_SECONDS - 0.1))).toBe('a');
    expect(findActiveBookmarkId(timeline, 10 + (BOOKMARK_ACTIVE_WINDOW_SECONDS - 0.1))).toBe('a');
  });

  it('excludes the window boundary, so exactly one bookmark cannot flicker in and out', () => {
    expect(findActiveBookmarkId(timeline, 10 + BOOKMARK_ACTIVE_WINDOW_SECONDS)).toBeNull();
    expect(findActiveBookmarkId(timeline, 10 - BOOKMARK_ACTIVE_WINDOW_SECONDS)).toBeNull();
  });

  it('picks the nearest when two bookmarks overlap, not the first found', () => {
    expect(findActiveBookmarkId(timeline, 30.4)).toBe('b');
    expect(findActiveBookmarkId(timeline, 30.6)).toBe('c');
  });

  it('handles an empty timeline', () => {
    expect(findActiveBookmarkId([], 10)).toBeNull();
  });
});
