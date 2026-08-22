import { describe, expect, it } from '@jest/globals';
import { compareVersions, normalizeVersion } from '../src/utils/version';

// These two functions decide whether the in-app updater offers an update at all.
// A regression here either hides releases or offers downgrades, so they are worth
// pinning even though they look trivial.

describe('normalizeVersion', () => {
  it('strips a v prefix', () => {
    expect(normalizeVersion('v1.8.0')).toBe('1.8.0');
    expect(normalizeVersion('V1.8.0')).toBe('1.8.0');
  });

  it('drops build metadata and prerelease suffixes', () => {
    expect(normalizeVersion('v1.8.0-build.42')).toBe('1.8.0');
    expect(normalizeVersion('1.8.0+abc123')).toBe('1.8.0');
    expect(normalizeVersion('  v1.8.0  ')).toBe('1.8.0');
  });

  it('returns empty for empty input', () => {
    expect(normalizeVersion('')).toBe('');
  });
});

describe('compareVersions', () => {
  it('orders by numeric precedence, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
  });

  it('treats equal versions as equal regardless of formatting', () => {
    expect(compareVersions('v1.8.0', '1.8.0')).toBe(0);
    expect(compareVersions('1.8', '1.8.0')).toBe(0);
  });

  it('ignores the build suffix the CI tags releases with', () => {
    expect(compareVersions('v1.8.0-build.7', '1.8.0')).toBe(0);
    expect(compareVersions('v1.8.1-build.1', '1.8.0')).toBe(1);
  });

  it('detects the update case the release flow relies on', () => {
    // latest > current means "offer the update"
    expect(compareVersions('v1.9.0-build.3', '1.8.0')).toBe(1);
    // and never the other way round
    expect(compareVersions('1.8.0', 'v1.9.0-build.3')).toBe(-1);
  });
});
