import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/utils/constants', () => ({
  AI_PROXY_URL: 'https://proxy.example.dev',
  GITHUB_OWNER: 'owner',
  GITHUB_REPO: 'repo',
  GITHUB_RELEASES_URL: '',
}));

const mockFetch = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/utils/network', () => ({
  fetchWithTimeout: (url: string) => mockFetch(url),
  NetworkTimeoutError: class extends Error {},
}));

import pkg from '../package.json';
import { UpdateService, releaseSources } from '../src/services/UpdateService';

const PROXY = 'https://proxy.example.dev/v1/latest-release';
const DIRECT = 'https://api.github.com/repos/owner/repo/releases/latest';
const reply = (status: number, body: unknown = {}) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
const release = (tag: string, htmlUrl = `https://github.com/owner/repo/releases/tag/${tag}`) =>
  ({ tag_name: tag, html_url: htmlUrl, body: 'notes', assets: [] });
const [major] = String(pkg.version).split('.').map(Number);
const newer = `v${major + 1}.0.0`;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('update check', () => {
  it('asks the proxy first, which is not bound by GitHub\'s per-IP budget', async () => {
    expect(releaseSources()).toEqual([PROXY, DIRECT]);
    mockFetch.mockImplementation(() => reply(200, release(newer)));
    const info = await UpdateService.checkForUpdates();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(PROXY);
    expect(info).toMatchObject({ available: true, checkFailed: false, latestVersion: `${major + 1}.0.0` });
  });

  it('falls back to GitHub when the proxy is down or not deployed', async () => {
    mockFetch.mockImplementation(url => (url === PROXY ? reply(404) : reply(200, release(newer))));
    const info = await UpdateService.checkForUpdates();
    expect(mockFetch.mock.calls.map(c => c[0])).toEqual([PROXY, DIRECT]);
    expect(info.available).toBe(true);
  });

  it('reports a rate limit as a failed check, not as "up to date"', async () => {
    // The shipped behaviour: 403 became available=false, which also wiped a found update.
    mockFetch.mockImplementation(() => reply(403));
    const info = await UpdateService.checkForUpdates();
    expect(info).toMatchObject({ available: false, checkFailed: true });
  });

  it('reports a network error as a failed check', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));
    expect((await UpdateService.checkForUpdates()).checkFailed).toBe(true);
  });

  it('treats a malformed tag as a failed check, never as an update', async () => {
    mockFetch.mockImplementation(() => reply(200, release('v9.x.0')));
    expect(await UpdateService.checkForUpdates()).toMatchObject({ available: false, checkFailed: true });
  });

  it('a successful check that finds nothing newer is a real "no update"', async () => {
    mockFetch.mockImplementation(() => reply(200, release(`v${pkg.version}`)));
    expect(await UpdateService.checkForUpdates()).toMatchObject({ available: false, checkFailed: false });
  });

  it('only links to this repository\'s releases', async () => {
    mockFetch.mockImplementation(() => reply(200, release(newer, 'https://evil.example/release')));
    const info = await UpdateService.checkForUpdates();
    expect(info.available).toBe(true);
    expect(info.releaseUrl).toBeNull();
  });
});
