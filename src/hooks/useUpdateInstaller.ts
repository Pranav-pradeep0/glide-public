import { useCallback, useEffect } from 'react';
import { Linking, NativeModules, Platform } from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { compareVersions, normalizeVersion } from '@/utils/version';
import { isTrustedAssetUrl } from '@/services/UpdateService';
import { fetchWithTimeout } from '@/utils/network';
import { updateStorage, UpdateApkCache } from '@/storage/updateStorage';
import { useAppStore } from '@/store/appStore';
import pkg from '../../package.json';

// One constant cache name, so no release-supplied string ever reaches a file path.
const APK_NAME = 'glide-update.apk';
const PART_NAME = 'glide-update.apk.part';
const APK_PATH = `${RNFS.CachesDirectoryPath}/${APK_NAME}`;
const PART_PATH = `${RNFS.CachesDirectoryPath}/${PART_NAME}`;

const MAX_APK_BYTES = 300 * 1024 * 1024;
const CHECKSUM_TIMEOUT_MS = 8000;
const CONNECTION_TIMEOUT_MS = 15000;
// No progress for this long means the transfer has stalled.
const READ_TIMEOUT_MS = 60000;
const SHA256_HEX = /\b([a-f0-9]{64})\b/i;

export type UpdateErrorKind =
    | 'network'
    | 'storage'
    | 'integrity'
    | 'cancelled'
    | 'unknown-sources'
    | 'installer'
    | 'unsupported-device';

export interface UpdateError {
    kind: UpdateErrorKind;
    message: string;
    /** True when opening the release page in a browser is a sensible next step. */
    canOpenRelease: boolean;
}

class DownloadError extends Error {
    readonly kind: UpdateErrorKind;
    constructor(kind: UpdateErrorKind, message: string) {
        super(message);
        this.kind = kind;
    }
}

// Native reject codes come from ApkInstallerModule's PackageInstaller status mapping.
const INSTALL_ERRORS: Record<string, UpdateError> = {
    INSTALL_CANCELLED: { kind: 'cancelled', message: 'Install cancelled.', canOpenRelease: false },
    UNKNOWN_SOURCES_DENIED: {
        kind: 'unknown-sources',
        message: 'Allow Glide to install apps, then try again.',
        canOpenRelease: false,
    },
    INSTALL_BLOCKED: {
        kind: 'installer',
        message: 'The system blocked this install. Check Play Protect or your device policy.',
        canOpenRelease: true,
    },
    INSTALL_CONFLICT: {
        kind: 'installer',
        message: 'This update conflicts with the installed copy of Glide. It may be signed by a different key.',
        canOpenRelease: true,
    },
    INSTALL_INCOMPATIBLE: {
        kind: 'unsupported-device',
        message: 'This build is not compatible with your device.',
        canOpenRelease: true,
    },
    INSTALL_INVALID: {
        kind: 'integrity',
        message: 'The downloaded update is damaged. Try again.',
        canOpenRelease: true,
    },
    INSTALL_STORAGE: {
        kind: 'storage',
        message: 'Not enough storage to install the update.',
        canOpenRelease: false,
    },
    INVALID_FILE: {
        kind: 'integrity',
        message: 'The downloaded update is damaged. Try again.',
        canOpenRelease: true,
    },
};

const GENERIC_INSTALL_ERROR: UpdateError = {
    kind: 'installer',
    message: 'The update could not be installed.',
    canOpenRelease: true,
};

interface UseUpdateInstallerParams {
    latestVersion: string | null;
    releaseUrl: string | null;
    apkUrl: string | null;
    apkSha256Url: string | null;
}

// One download at a time, app-wide: the modal and the Settings card share both the
// destination file and the store slice, so the job id cannot live in a component.
let activeJobId: number | null = null;
// Atomic owner for the whole checksum -> download -> verify -> install operation. Store
// state is for rendering and can be stale inside a second button's callback.
let activeDownloadOperation: Promise<void> | null = null;
// stopDownload makes the job promise reject, which is indistinguishable from a network
// failure, so remember that the rejection was asked for.
let cancelRequested = false;
// Which latestVersion the cache was last checked against. Both consumers mount this
// hook, and the update check resolves after mount, so the sweep must re-run when the
// known latest version changes but only once per value.
let sweptForVersion: string | null | undefined;

async function safeDelete(filePath: string): Promise<void> {
    try {
        if (await RNFS.exists(filePath)) {
            await RNFS.unlink(filePath);
        }
    } catch (error) {
        if (__DEV__) {
            console.warn('[useUpdateInstaller] Failed to delete', filePath, error);
        }
    }
}

async function fetchExpectedHash(sha256Url: string): Promise<string> {
    let response: Response;
    try {
        response = await fetchWithTimeout(sha256Url, {}, CHECKSUM_TIMEOUT_MS);
    } catch {
        throw new DownloadError('network', 'Could not fetch the update checksum.');
    }
    if (!response.ok) {
        throw new DownloadError('network', 'Could not fetch the update checksum.');
    }
    // sha256sum output is "<hash>  <filename>".
    const match = SHA256_HEX.exec(await response.text());
    if (!match) {
        throw new DownloadError('integrity', 'The published checksum is malformed.');
    }
    return match[1].toLowerCase();
}

export function useUpdateInstaller({
    latestVersion,
    releaseUrl,
    apkUrl,
    apkSha256Url,
}: UseUpdateInstallerParams) {
    const { isDownloading, downloadProgress, cachedApk, error } = useAppStore(
        (state) => state.updateInstall
    );
    const setUpdateInstall = useAppStore((state) => state.setUpdateInstall);

    const setError = useCallback(
        (next: UpdateError | null) => setUpdateInstall({ error: next }),
        [setUpdateInstall]
    );
    const setCachedApk = useCallback(
        (next: UpdateApkCache | null) => setUpdateInstall({ cachedApk: next }),
        [setUpdateInstall]
    );

    const currentVersion = normalizeVersion(String(pkg.version || '0.0.0'));
    // Without a checksum there is nothing to verify the download against, so treat the
    // release as browser-only rather than installing bytes we cannot check.
    const hasInstaller = isTrustedAssetUrl(apkUrl);
    const canDownload = hasInstaller && Boolean(apkSha256Url);

    // Two different situations disable the button, and the user can act on them
    // differently, so name the one that applies instead of collapsing both.
    const unavailableReason: string | null = canDownload
        ? null
        : hasInstaller
            ? 'That release publishes no checksum, so the download cannot be verified here. Open the release page to install it manually.'
            : 'No installer for this device in that release. Open the release page to see what it offers.';
    const hasCachedApk = Boolean(cachedApk?.path);

    const cancelActiveDownload = useCallback(() => {
        if (activeJobId !== null) {
            RNFS.stopDownload(activeJobId);
        }
    }, []);

    const clearError = useCallback(() => setError(null), [setError]);

    const handleCancelDownload = useCallback(() => {
        cancelRequested = true;
        cancelActiveDownload();
        setUpdateInstall({
            isDownloading: false,
            downloadProgress: null,
            error: { kind: 'cancelled', message: 'Download cancelled.', canOpenRelease: false },
        });
    }, [cancelActiveDownload, setUpdateInstall]);

    // Drop a cached APK that is stale, unverifiable, or already installed. Both consumers
    // mount this hook and the update check resolves after mount, so this runs once per
    // distinct latestVersion rather than once per component.
    useEffect(() => {
        if (isDownloading || sweptForVersion === latestVersion) {
            return;
        }
        sweptForVersion = latestVersion;

        const sweep = async () => {
            const cached = updateStorage.load();
            const discard = async () => {
                await safeDelete(APK_PATH);
                await safeDelete(PART_PATH);
                updateStorage.clear();
                setCachedApk(null);
            };

            if (!cached) {
                await safeDelete(PART_PATH);
                setCachedApk(null);
                return;
            }
            if (
                cached.path !== APK_PATH ||
                compareVersions(currentVersion, cached.version) >= 0 ||
                (latestVersion && compareVersions(cached.version, latestVersion) !== 0) ||
                !(await RNFS.exists(cached.path))
            ) {
                await discard();
                return;
            }
            setCachedApk(cached);
        };

        sweep();
    }, [currentVersion, isDownloading, latestVersion, setCachedApk]);

    const handleOpenRelease = useCallback(async () => {
        if (!releaseUrl) {return;}
        try {
            await Linking.openURL(releaseUrl);
        } catch {
            // Nothing further to offer if no browser can handle it.
        }
    }, [releaseUrl]);

    const runInstall = useCallback(async (filePath: string) => {
        if (Platform.OS !== 'android') {
            setError(GENERIC_INSTALL_ERROR);
            return;
        }
        try {
            const allowed = await NativeModules.ApkInstallerModule.canInstallPackages();
            if (!allowed) {
                setError(INSTALL_ERRORS.UNKNOWN_SOURCES_DENIED);
                await NativeModules.ApkInstallerModule.openUnknownSourcesSettings();
                return;
            }
            await NativeModules.ApkInstallerModule.install(filePath);
        } catch (e) {
            const code = (e as { code?: string })?.code;
            setError((code && INSTALL_ERRORS[code]) || GENERIC_INSTALL_ERROR);
        }
    }, [setError]);

    const download = useCallback(async (): Promise<string> => {
        if (!apkUrl || !apkSha256Url || !isTrustedAssetUrl(apkUrl) || !isTrustedAssetUrl(apkSha256Url)) {
            throw new DownloadError('network', 'This release has no verifiable download.');
        }

        const expectedHash = await fetchExpectedHash(apkSha256Url);
        if (cancelRequested) {
            throw new DownloadError('cancelled', 'Download cancelled.');
        }
        await safeDelete(PART_PATH);
        if (cancelRequested) {
            throw new DownloadError('cancelled', 'Download cancelled.');
        }

        const job = RNFS.downloadFile({
            fromUrl: apkUrl,
            toFile: PART_PATH,
            connectionTimeout: CONNECTION_TIMEOUT_MS,
            readTimeout: READ_TIMEOUT_MS,
            progressDivider: 1,
            progress: (res) => {
                if (res.contentLength > MAX_APK_BYTES) {
                    cancelActiveDownload();
                    return;
                }
                if (res.contentLength > 0) {
                    setUpdateInstall({
                        downloadProgress: Math.round((res.bytesWritten / res.contentLength) * 100),
                    });
                }
            },
        });
        activeJobId = job.jobId;

        let result: RNFS.DownloadResultT;
        try {
            result = await job.promise;
        } catch {
            throw cancelRequested
                ? new DownloadError('cancelled', 'Download cancelled.')
                : new DownloadError('network', 'The download did not finish.');
        } finally {
            activeJobId = null;
        }

        if (cancelRequested) {
            throw new DownloadError('cancelled', 'Download cancelled.');
        }
        if (result.statusCode !== 200) {
            throw new DownloadError('network', `The download failed (HTTP ${result.statusCode}).`);
        }
        if (result.bytesWritten > MAX_APK_BYTES) {
            throw new DownloadError('integrity', 'The download was larger than expected.');
        }

        const actualHash = (await RNFS.hash(PART_PATH, 'sha256')).toLowerCase();
        if (actualHash !== expectedHash) {
            throw new DownloadError('integrity', 'The download did not match its published checksum.');
        }
        if (cancelRequested) {
            throw new DownloadError('cancelled', 'Download cancelled.');
        }

        // Only a verified file is allowed to take the install path's name.
        await safeDelete(APK_PATH);
        await RNFS.moveFile(PART_PATH, APK_PATH);
        return APK_PATH;
    }, [apkSha256Url, apkUrl, cancelActiveDownload, setUpdateInstall]);

    const handleDownloadAndInstall = useCallback((): Promise<void> => {
        if (!canDownload) {return Promise.resolve();}
        if (activeDownloadOperation) {return activeDownloadOperation;}

        cancelRequested = false;
        setUpdateInstall({ error: null, isDownloading: true, downloadProgress: 0 });

        const operation = (async () => {
            try {
                const path = await download();
                if (cancelRequested) {
                    throw new DownloadError('cancelled', 'Download cancelled.');
                }
                const cache: UpdateApkCache = {
                    version: normalizeVersion(latestVersion || ''),
                    path,
                    fileName: APK_NAME,
                    savedAt: Date.now(),
                };
                // Metadata is written only after the checksum passes.
                updateStorage.save(cache);
                setCachedApk(cache);
                await runInstall(path);
            } catch (e) {
                await safeDelete(PART_PATH);
                if (e instanceof DownloadError) {
                    setError({
                        kind: e.kind,
                        message: e.message,
                        canOpenRelease: e.kind !== 'cancelled',
                    });
                } else {
                    if (__DEV__) {
                        console.warn('[useUpdateInstaller] Download failed:', e);
                    }
                    setError({ kind: 'network', message: 'The update could not be downloaded.', canOpenRelease: true });
                }
            } finally {
                setUpdateInstall({ isDownloading: false, downloadProgress: null });
            }
        })();

        activeDownloadOperation = operation;
        operation.finally(() => {
            if (activeDownloadOperation === operation) {
                activeDownloadOperation = null;
            }
        });
        return operation;
    }, [
        canDownload,
        download,
        latestVersion,
        runInstall,
        setCachedApk,
        setError,
        setUpdateInstall,
    ]);

    const handleInstallCached = useCallback(async () => {
        if (!cachedApk) {return;}
        setError(null);
        await runInstall(cachedApk.path);
    }, [cachedApk, runInstall, setError]);

    return {
        canDownload,
        unavailableReason,
        cachedApk,
        clearError,
        downloadProgress,
        error,
        hasCachedApk,
        isDownloading,
        handleCancelDownload,
        handleDownloadAndInstall,
        handleInstallCached,
        handleOpenRelease,
    };
}
