import { describe, expect, it } from '@jest/globals';
import { hudReducer, initialHUDState } from '../src/hooks/video-player/usePlayerHUD';

// UPDATE_ZOOM returning a fresh object for an unchanged scale caused an unbounded
// render loop: new hud.state -> new hud object -> new resetZoom -> the effect that
// calls resetZoom re-fires -> repeat. Identity stability here is load-bearing, not
// a micro-optimisation.

describe('hudReducer UPDATE_ZOOM', () => {
  it('returns the identical state object when the scale has not changed', () => {
    const next = hudReducer(initialHUDState, { type: 'UPDATE_ZOOM', scale: initialHUDState.zoom.scale });
    expect(next).toBe(initialHUDState);
  });

  it('is idempotent when dispatched repeatedly with the same scale', () => {
    const zoomed = hudReducer(initialHUDState, { type: 'UPDATE_ZOOM', scale: 2 });
    const again = hudReducer(zoomed, { type: 'UPDATE_ZOOM', scale: 2 });
    expect(again).toBe(zoomed);
  });

  it('still produces new state for a genuinely different scale', () => {
    const next = hudReducer(initialHUDState, { type: 'UPDATE_ZOOM', scale: 2.5 });
    expect(next).not.toBe(initialHUDState);
    expect(next.zoom.scale).toBe(2.5);
  });
});
