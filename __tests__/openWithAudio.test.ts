import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/services/FileService', () => ({ FileService: {} }));

import { DeepLinkService } from '../src/services/DeepLinkService';

// MainActivity is exported: any app can hand it any URI. Only local audio may play.
describe('DeepLinkService.isOpenableAudioUri', () => {
    it('accepts local content and file URIs', () => {
        expect(DeepLinkService.isOpenableAudioUri('content://media/external/audio/media/42')).toBe(true);
        expect(DeepLinkService.isOpenableAudioUri('file:///storage/emulated/0/Music/song.mp3')).toBe(true);
    });

    it('rejects remote, unknown and malformed URIs', () => {
        expect(DeepLinkService.isOpenableAudioUri('https://example.com/song.mp3')).toBe(false);
        expect(DeepLinkService.isOpenableAudioUri('smb://server/share/song.mp3')).toBe(false);
        expect(DeepLinkService.isOpenableAudioUri('content://')).toBe(false);
        expect(DeepLinkService.isOpenableAudioUri('content://a b')).toBe(false);
    });

    it('rejects oversized URIs', () => {
        expect(DeepLinkService.isOpenableAudioUri(`content://x/${'a'.repeat(8200)}`)).toBe(false);
    });
});
