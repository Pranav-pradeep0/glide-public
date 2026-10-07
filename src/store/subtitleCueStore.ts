import { create } from 'zustand';
import type { SubtitleCue } from '../types';

interface SubtitleCueState {
    currentCue: SubtitleCue | null;
    setCurrentCue: (cue: SubtitleCue | null) => void;
    clearCue: () => void;
}

export const useSubtitleCueStore = create<SubtitleCueState>((set) => ({
    currentCue: null,
    setCurrentCue: (currentCue) =>
        set((state) => {
            if (
                state.currentCue === currentCue ||
                (state.currentCue?.text === currentCue?.text &&
                    state.currentCue?.startTime === currentCue?.startTime)
            ) {
                return state;
            }
            return { currentCue };
        }),
    clearCue: () =>
        set((state) => {
            if (state.currentCue === null) {
                return state;
            }
            return { currentCue: null };
        }),
}));
