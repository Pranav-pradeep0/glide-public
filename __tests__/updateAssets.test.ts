import { describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';

jest.mock('@/utils/constants', () => ({
  GITHUB_OWNER: 'owner',
  GITHUB_REPO: 'repo',
  GITHUB_RELEASES_URL: '',
}));

import { isTrustedAssetUrl, selectApkForDevice } from '../src/services/UpdateService';

// getPreferredAbi reads Platform.OS at call time, so this takes effect for every case.
Object.defineProperty(Platform, 'OS', { get: () => 'android' });

const RELEASE = 'https://github.com/owner/repo/releases/download/v1.8.2';

// Shipped 1.8.1 read a nonexistent PlatformConstants.supportedAbis field, so every device
// fell through to an arm64 fallback and armeabi-v7a installs failed with no visible error.
const assets = [
  { name: 'Glide-v1.8.2-arm.apk', browser_download_url: `${RELEASE}/arm.apk` },
  { name: 'Glide-v1.8.2-arm.apk.sha256', browser_download_url: `${RELEASE}/arm.apk.sha256` },
  { name: 'Glide-v1.8.2-arm64.apk', browser_download_url: `${RELEASE}/arm64.apk` },
  { name: 'Glide-v1.8.2-arm64.apk.sha256', browser_download_url: `${RELEASE}/arm64.apk.sha256` },
];

describe('selectApkForDevice', () => {
  it('gives a 64-bit device the arm64 asset and its checksum', () => {
    expect(selectApkForDevice(assets, ['arm64-v8a', 'armeabi-v7a'])).toEqual({
      apkUrl: `${RELEASE}/arm64.apk`,
      sha256Url: `${RELEASE}/arm64.apk.sha256`,
    });
  });

  it('gives a 32-bit-only device the arm asset, not arm64', () => {
    expect(selectApkForDevice(assets, ['armeabi-v7a'])).toEqual({
      apkUrl: `${RELEASE}/arm.apk`,
      sha256Url: `${RELEASE}/arm.apk.sha256`,
    });
  });

  it('offers nothing when the ABI is unknown, so the UI opens the release page', () => {
    expect(selectApkForDevice(assets, [])).toBeNull();
    expect(selectApkForDevice(assets, ['x86_64'])).toBeNull();
    expect(selectApkForDevice(assets, undefined)).toBeNull();
  });

  it('ignores asset ordering', () => {
    expect(selectApkForDevice([...assets].reverse(), ['arm64-v8a'])?.apkUrl).toBe(
      `${RELEASE}/arm64.apk`
    );
  });

  it('returns null when the matching ABI asset is missing', () => {
    const arm64Only = assets.filter((a) => a.name.includes('arm64'));
    expect(selectApkForDevice(arm64Only, ['armeabi-v7a'])).toBeNull();
  });

  it('reports a missing checksum rather than pretending the download is verifiable', () => {
    const noChecksums = assets.filter((a) => !a.name.endsWith('.sha256'));
    expect(selectApkForDevice(noChecksums, ['arm64-v8a'])).toEqual({
      apkUrl: `${RELEASE}/arm64.apk`,
      sha256Url: null,
    });
  });

  it('refuses an APK asset pointed at an untrusted host', () => {
    const hijacked = [
      { name: 'Glide-v1.8.2-arm64.apk', browser_download_url: 'https://evil.example/arm64.apk' },
      { name: 'Glide-v1.8.2-arm64.apk.sha256', browser_download_url: `${RELEASE}/arm64.apk.sha256` },
    ];
    expect(selectApkForDevice(hijacked, ['arm64-v8a'])).toBeNull();
  });

  it('drops an untrusted checksum but keeps the trusted APK unverifiable', () => {
    const mixed = [
      { name: 'Glide-v1.8.2-arm64.apk', browser_download_url: `${RELEASE}/arm64.apk` },
      { name: 'Glide-v1.8.2-arm64.apk.sha256', browser_download_url: 'http://evil.example/x.sha256' },
    ];
    expect(selectApkForDevice(mixed, ['arm64-v8a'])).toEqual({
      apkUrl: `${RELEASE}/arm64.apk`,
      sha256Url: null,
    });
  });
});

describe('isTrustedAssetUrl', () => {
  it('accepts GitHub release hosts over HTTPS', () => {
    expect(isTrustedAssetUrl('https://github.com/o/r/releases/download/v1/a.apk')).toBe(true);
    expect(isTrustedAssetUrl('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isTrustedAssetUrl('https://release-assets.githubusercontent.com/x')).toBe(true);
  });

  it('rejects cleartext, other hosts, and lookalike prefixes', () => {
    expect(isTrustedAssetUrl('http://github.com/o/r/a.apk')).toBe(false);
    expect(isTrustedAssetUrl('https://evil.example/a.apk')).toBe(false);
    expect(isTrustedAssetUrl('https://github.com.evil.example/a.apk')).toBe(false);
    expect(isTrustedAssetUrl('https://notgithub.com/a.apk')).toBe(false);
    expect(isTrustedAssetUrl(null)).toBe(false);
    expect(isTrustedAssetUrl(undefined)).toBe(false);
  });
});
