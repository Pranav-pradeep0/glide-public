import { GITHUB_OWNER, GITHUB_REPO, GITHUB_RELEASES_URL } from '@/utils/constants';
import { compareVersions, normalizeVersion } from '@/utils/version';
import pkg from '../../package.json';
import { NativeModules, Platform } from 'react-native';

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

function getPreferredAbi(): 'arm64' | 'arm' | null {
    if (Platform.OS !== 'android') {return null;}
    const supportedAbis: string[] | undefined = NativeModules?.PlatformConstants?.supportedAbis;
    if (!supportedAbis || supportedAbis.length === 0) {return null;}

    const lower = supportedAbis.map((abi) => String(abi).toLowerCase());
    if (lower.some((abi) => abi.includes('arm64'))) {return 'arm64';}
    if (lower.some((abi) => abi.includes('armeabi') || abi.includes('arm'))) {return 'arm';}
    return null;
}

function selectApkForDevice(assets: GitHubReleaseResponse['assets']): string | null {
    const apkAssets = (assets || []).filter((asset) =>
        (asset.name || '').toLowerCase().endsWith('.apk')
    );
    if (apkAssets.length === 0) {return null;}

    const preferredAbi = getPreferredAbi();
    if (preferredAbi === 'arm64') {
        const arm64 = apkAssets.find((asset) => (asset.name || '').toLowerCase().includes('arm64'));
        if (arm64?.browser_download_url) {return arm64.browser_download_url;}
    }
    if (preferredAbi === 'arm') {
        const arm = apkAssets.find((asset) => (asset.name || '').toLowerCase().includes('arm'));
        if (arm?.browser_download_url) {return arm.browser_download_url;}
    }

    // Fallback: prefer arm64 if available, otherwise first apk
    const fallbackArm64 = apkAssets.find((asset) => (asset.name || '').toLowerCase().includes('arm64'));
    return fallbackArm64?.browser_download_url || apkAssets[0]?.browser_download_url || null;
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
            const response = await fetch(releasesUrl, {
                headers: {
                    Accept: 'application/vnd.github+json',
                },
            });

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
