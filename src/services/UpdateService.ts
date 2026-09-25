import { AI_PROXY_URL, GITHUB_OWNER, GITHUB_REPO, GITHUB_RELEASES_URL } from '@/utils/constants';
import { compareVersions, normalizeVersion } from '@/utils/version';
import { fetchWithTimeout, NetworkTimeoutError } from '@/utils/network';
import pkg from '../../package.json';
import { NativeModules, Platform } from 'react-native';
const UPDATE_CHECK_TIMEOUT_MS = 8000;
// Release notes are attacker-influenced Markdown rendered in the update modal.
const MAX_RELEASE_NOTES_CHARS = 8000;

// GitHub serves release assets from these hosts. The SHA-256 check is the real
// integrity control; this only stops an edited release pointing the download elsewhere.
const TRUSTED_ASSET_URL =
    /^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//;

export function isTrustedAssetUrl(url: string | null | undefined): boolean {
    return typeof url === 'string' && TRUSTED_ASSET_URL.test(url);
}

export interface UpdateInfo {
    available: boolean;
    /**
     * The check could not tell: network error, rate limit, or an unusable response. Distinct
     * from "no update" -- the caller must keep what it knew rather than clear a found update.
     */
    checkFailed: boolean;
    currentVersion: string;
    latestVersion: string | null;
    releaseUrl: string | null;
    releaseNotes: string | null;
    apkUrl: string | null;
    apkSha256Url: string | null;
}

interface GitHubReleaseResponse {
    tag_name: string;
    html_url: string;
    body?: string;
    assets?: Array<{
        name?: string;
        browser_download_url?: string;
    }>;
    prerelease?: boolean;
    draft?: boolean;
}

/**
 * Where to ask, in order. The proxy first: it calls GitHub with a token and caches, so it is
 * not subject to GitHub's 60-requests-an-hour-per-IP budget that users behind one carrier
 * NAT share and silently exhaust. GitHub direct is the fallback, e.g. before the proxy route
 * is deployed.
 */
export function releaseSources(): string[] {
    if (GITHUB_RELEASES_URL) {
        // A custom endpoint is build configuration rather than user input, but it still
        // decides which release the updater offers and which APK it points at. Over
        // cleartext the network decides that instead, so a non-HTTPS override fails closed.
        return GITHUB_RELEASES_URL.startsWith('https://') ? [GITHUB_RELEASES_URL] : [];
    }
    if (!GITHUB_OWNER || !GITHUB_REPO) {
        return [];
    }
    return [
        ...(AI_PROXY_URL ? [`${AI_PROXY_URL}/v1/latest-release`] : []),
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    ];
}

/** The "Open release" link may only point at this repository's releases. */
function isOwnReleaseUrl(url: string | undefined): url is string {
    return typeof url === 'string' && GITHUB_OWNER !== '' && GITHUB_REPO !== '' &&
        url.startsWith(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/`);
}

// Release assets are named Glide-vX.Y.Z-arm.apk / Glide-vX.Y.Z-arm64.apk by the release workflow.
const ABI_ASSET_SUFFIX = {
    arm64: '-arm64.apk',
    arm: '-arm.apk',
} as const;

export function getPreferredAbi(
    supportedAbis?: string[]
): keyof typeof ABI_ASSET_SUFFIX | null {
    if (Platform.OS !== 'android') {return null;}
    // PlatformConstants has no ABI field; ApkInstallerModule exports Build.SUPPORTED_ABIS.
    const abis = supportedAbis ?? NativeModules?.ApkInstallerModule?.SUPPORTED_ABIS;
    if (!Array.isArray(abis) || abis.length === 0) {return null;}

    const lower = abis.map((abi) => String(abi).toLowerCase());
    if (lower.includes('arm64-v8a')) {return 'arm64';}
    if (lower.includes('armeabi-v7a')) {return 'arm';}
    return null;
}

export interface SelectedApk {
    apkUrl: string;
    /** Checksum published beside the APK. Null means the download cannot be verified. */
    sha256Url: string | null;
}

export function selectApkForDevice(
    assets: GitHubReleaseResponse['assets'],
    supportedAbis?: string[]
): SelectedApk | null {
    const abi = getPreferredAbi(supportedAbis);
    // Unknown ABI: offer the release page rather than guessing an incompatible APK.
    if (!abi) {return null;}

    const suffix = ABI_ASSET_SUFFIX[abi];
    const all = assets || [];
    const apk = all.find((candidate) => (candidate.name || '').toLowerCase().endsWith(suffix));
    const apkUrl = apk?.browser_download_url;
    if (!apkUrl || !apk?.name || !isTrustedAssetUrl(apkUrl)) {return null;}

    const checksumName = `${apk.name.toLowerCase()}.sha256`;
    const checksum = all.find((candidate) => (candidate.name || '').toLowerCase() === checksumName);
    const sha256Url = checksum?.browser_download_url;

    return {
        apkUrl,
        sha256Url: isTrustedAssetUrl(sha256Url) ? sha256Url! : null,
    };
}


function noUpdate(currentVersion: string, checkFailed = false): UpdateInfo {
    return {
        available: false,
        checkFailed,
        currentVersion,
        latestVersion: null,
        releaseUrl: null,
        releaseNotes: null,
        apkUrl: null,
        apkSha256Url: null,
    };
}

/**
 * The release the updater offers, from a GitHub `releases/latest` response, or null when the
 * response is not a usable release -- which is a failed check, not "no update".
 */
export function parseRelease(data: GitHubReleaseResponse | null, currentVersion: string): UpdateInfo | null {
    if (!data || typeof data.tag_name !== 'string') {return null;}
    // /releases/latest already excludes drafts and prereleases; this guards a custom
    // GITHUB_RELEASES_URL that does not. A real answer, just not an update.
    if (data.prerelease || data.draft) {return noUpdate(currentVersion);}

    const latestVersion = normalizeVersion(data.tag_name);
    if (!latestVersion) {return null;}
    const releaseNotes = data.body
        ? String(data.body).trim().slice(0, MAX_RELEASE_NOTES_CHARS)
        : null;
    const selected = selectApkForDevice(data.assets);
    return {
        available: compareVersions(latestVersion, currentVersion) > 0,
        checkFailed: false,
        currentVersion,
        latestVersion,
        releaseUrl: isOwnReleaseUrl(data.html_url) ? data.html_url : null,
        releaseNotes: releaseNotes || null,
        apkUrl: selected?.apkUrl || null,
        apkSha256Url: selected?.sha256Url || null,
    };
}

export class UpdateService {
    static async checkForUpdates(): Promise<UpdateInfo> {
        const currentVersion = String(pkg.version || '0.0.0');
        const sources = releaseSources();

        for (const url of sources) {
            try {
                const response = await fetchWithTimeout(url, {
                    headers: {
                        Accept: 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2026-03-10',
                    },
                }, UPDATE_CHECK_TIMEOUT_MS);
                if (!response.ok) {
                    // Status only. 403/429 is GitHub's per-IP budget, shared behind carrier NAT.
                    console.warn('[UpdateService] Release check failed:', response.status);
                    continue;
                }
                const info = parseRelease((await response.json()) as GitHubReleaseResponse, currentVersion);
                if (info) {return info;}
                console.warn('[UpdateService] Release response was not a usable release');
            } catch (error) {
                console.warn(
                    '[UpdateService] Release check failed:',
                    error instanceof NetworkTimeoutError ? `timed out after ${error.timeoutMs}ms` : String(error)
                );
            }
        }
        return noUpdate(currentVersion, true);
    }
}
