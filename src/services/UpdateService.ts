import { GITHUB_OWNER, GITHUB_REPO, GITHUB_RELEASES_URL } from '@/utils/constants';
import { compareVersions, normalizeVersion } from '@/utils/version';
import { fetchWithTimeout, NetworkTimeoutError } from '@/utils/network';
import pkg from '../../package.json';
import { NativeModules, Platform } from 'react-native';
const UPDATE_CHECK_TIMEOUT_MS = 8000;

export interface UpdateInfo {
    available: boolean;
    currentVersion: string;
    latestVersion: string | null;
    releaseUrl: string | null;
    releaseNotes: string | null;
    apkUrl: string | null;
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

function buildLatestReleaseUrl(): string | null {
    if (GITHUB_RELEASES_URL) {
        return GITHUB_RELEASES_URL;
    }
    if (!GITHUB_OWNER || !GITHUB_REPO) {
        return null;
    }
    return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
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

export function selectApkForDevice(
    assets: GitHubReleaseResponse['assets'],
    supportedAbis?: string[]
): string | null {
    const abi = getPreferredAbi(supportedAbis);
    // Unknown ABI: offer the release page rather than guessing an incompatible APK.
    if (!abi) {return null;}

    const suffix = ABI_ASSET_SUFFIX[abi];
    const asset = (assets || []).find((candidate) =>
        (candidate.name || '').toLowerCase().endsWith(suffix)
    );
    return asset?.browser_download_url || null;
}

export class UpdateService {
    static async checkForUpdates(): Promise<UpdateInfo> {
        const currentVersion = String(pkg.version || '0.0.0');
        const releasesUrl = buildLatestReleaseUrl();

        if (!releasesUrl) {
            return {
                available: false,
                currentVersion,
                latestVersion: null,
                releaseUrl: null,
                releaseNotes: null,
                apkUrl: null,
            };
        }

        try {
            const response = await fetchWithTimeout(releasesUrl, {
                headers: {
                    Accept: 'application/vnd.github+json',
                },
            }, UPDATE_CHECK_TIMEOUT_MS);

            if (!response.ok) {
                if (__DEV__) {
                    console.warn('[UpdateService] Failed to fetch releases:', response.status);
                }
                return {
                    available: false,
                    currentVersion,
                    latestVersion: null,
                    releaseUrl: null,
                    releaseNotes: null,
                    apkUrl: null,
                };
            }

            const data = (await response.json()) as GitHubReleaseResponse;

            if (!data?.tag_name) {
                return {
                    available: false,
                    currentVersion,
                    latestVersion: null,
                    releaseUrl: null,
                    releaseNotes: null,
                    apkUrl: null,
                };
            }

            if (data.prerelease || data.draft) {
                return {
                    available: false,
                    currentVersion,
                    latestVersion: null,
                    releaseUrl: null,
                    releaseNotes: null,
                    apkUrl: null,
                };
            }

            const latestVersion = normalizeVersion(data.tag_name);
            const isNewer = compareVersions(latestVersion, currentVersion) > 0;
            const releaseNotes = data.body ? String(data.body).trim() : null;
            const apkUrl = selectApkForDevice(data.assets);

            return {
                available: isNewer,
                currentVersion,
                latestVersion: latestVersion || null,
                releaseUrl: data.html_url || null,
                releaseNotes: releaseNotes || null,
                apkUrl: apkUrl || null,
            };
        } catch (error) {
            if (error instanceof NetworkTimeoutError) {
                if (__DEV__) {
                    console.warn('[UpdateService] Update check timed out:', error.timeoutMs);
                }
                return {
                    available: false,
                    currentVersion,
                    latestVersion: null,
                    releaseUrl: null,
                    releaseNotes: null,
                    apkUrl: null,
                };
            }
            if (__DEV__) {
                console.warn('[UpdateService] Update check failed:', error);
            }
            return {
                available: false,
                currentVersion,
                latestVersion: null,
                releaseUrl: null,
                releaseNotes: null,
                apkUrl: null,
            };
        }
    }
}
