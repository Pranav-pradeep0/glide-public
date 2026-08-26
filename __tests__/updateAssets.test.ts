import { describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';

jest.mock('@/utils/constants', () => ({
  GITHUB_OWNER: 'owner',
  GITHUB_REPO: 'repo',
  GITHUB_RELEASES_URL: '',
}));

import { selectApkForDevice } from '../src/services/UpdateService';

// getPreferredAbi reads Platform.OS at call time, so this takes effect for every case.
Object.defineProperty(Platform, 'OS', { get: () => 'android' });

// Shipped 1.8.1 read a nonexistent PlatformConstants.supportedAbis field, so every device
// fell through to an arm64 fallback and armeabi-v7a installs failed with no visible error.
const assets = [
  { name: 'Glide-v1.8.2-arm.apk', browser_download_url: 'https://x/arm.apk' },
  { name: 'Glide-v1.8.2-arm.apk.sha256', browser_download_url: 'https://x/arm.sha256' },
  { name: 'Glide-v1.8.2-arm64.apk', browser_download_url: 'https://x/arm64.apk' },
  { name: 'Glide-v1.8.2-arm64.apk.sha256', browser_download_url: 'https://x/arm64.sha256' },
];

describe('selectApkForDevice', () => {
  it('gives a 64-bit device the arm64 asset', () => {
    expect(selectApkForDevice(assets, ['arm64-v8a', 'armeabi-v7a'])).toBe('https://x/arm64.apk');
  });

  it('gives a 32-bit-only device the arm asset, not arm64', () => {
    expect(selectApkForDevice(assets, ['armeabi-v7a'])).toBe('https://x/arm.apk');
  });

  it('offers nothing when the ABI is unknown, so the UI opens the release page', () => {
    expect(selectApkForDevice(assets, [])).toBeNull();
    expect(selectApkForDevice(assets, ['x86_64'])).toBeNull();
    expect(selectApkForDevice(assets, undefined)).toBeNull();
  });

  it('ignores checksum assets and asset ordering', () => {
    expect(selectApkForDevice([...assets].reverse(), ['arm64-v8a'])).toBe('https://x/arm64.apk');
  });

  it('returns null when the matching ABI asset is missing', () => {
    const arm64Only = assets.filter((a) => a.name.includes('arm64'));
    expect(selectApkForDevice(arm64Only, ['armeabi-v7a'])).toBeNull();
  });
});
