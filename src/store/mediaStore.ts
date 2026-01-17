import { create } from 'zustand';

interface MediaState {
    selectedAlbum: string | null;
    isLoading: boolean;

    // Actions
    setSelectedAlbum: (album: string | null) => void;
    setIsLoading: (loading: boolean) => void;
}

export const useMediaStore = create<MediaState>((set) => ({
    selectedAlbum: null,
    isLoading: false,

    setSelectedAlbum: (album) => set({ selectedAlbum: album }),
    setIsLoading: (loading) => set({ isLoading: loading }),
}));
