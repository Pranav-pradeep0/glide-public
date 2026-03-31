import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, NativeModules, Platform } from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { compareVersions, normalizeVersion } from '@/utils/version';
import { updateStorage, UpdateApkCache } from '@/storage/updateStorage';
import pkg from '../../package.json';

interface UseUpdateInstallerParams {
    latestVersion: string | null;
    releaseUrl: string | null;
    apkUrl: string | null;
}

export function useUpdateInstaller({
    latestVersion,
    releaseUrl,
    apkUrl,
}: UseUpdateInstallerParams) {
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const [cachedApk, setCachedApk] = useState<UpdateApkCache | null>(null);

    const currentVersion = normalizeVersion(String(pkg.version || '0.0.0'));
    const canDownload = Boolean(apkUrl);
    const hasCachedApk = Boolean(cachedApk?.path);

    const safeDeleteFile = useCallback(async (filePath?: string | null) => {
        if (!filePath) {return;}
        try {
            const exists = await RNFS.exists(filePath);
            if (exists) {
                await RNFS.unlink(filePath);
            }
        } catch (error) {
            if (__DEV__) {
                console.warn('[useUpdateInstaller] Failed to delete cached APK:', error);
            }
        }
    }, []);

    useEffect(() => {
        let isActive = true;

        const loadCache = async () => {
            const cached = await updateStorage.load();
            if (!cached) {
                if (isActive) {setCachedApk(null);} 
                return;
            }

            if (compareVersions(currentVersion, cached.version) >= 0) {
                await safeDeleteFile(cached.path);
                await updateStorage.clear();
                if (isActive) {setCachedApk(null);} 
                return;
            }

            if (latestVersion && compareVersions(cached.version, latestVersion) !== 0) {
                await safeDeleteFile(cached.path);
                await updateStorage.clear();
                if (isActive) {setCachedApk(null);} 
                return;
            }

            const exists = await RNFS.exists(cached.path);
            if (!exists) {
                await updateStorage.clear();
                if (isActive) {setCachedApk(null);} 
                return;
            }

            if (isActive) {
                setCachedApk(cached);
            }
        };

        loadCache();

        return () => {
            isActive = false;
        };
    }, [currentVersion, latestVersion, safeDeleteFile]);

    const openInstaller = useCallback(async (filePath: string, _fileName: string) => {
        if (Platform.OS === 'android') {
            try {
                await NativeModules.ApkInstallerModule.install(filePath);
                return true;
            } catch (error) {
                if (__DEV__) {
                    console.warn('[useUpdateInstaller] Native install failed:', error);
                }
            }
        }

        try {
            const fileUrl = Platform.OS === 'android'
                ? `file://${filePath}`
                : filePath;
            await Linking.openURL(fileUrl);
            return true;
        } catch (error) {
            if (__DEV__) {
                console.warn('[useUpdateInstaller] Linking install failed:', error);
            }
        }

        return false;
    }, []);

    const handleOpenRelease = useCallback(async () => {
        if (!releaseUrl) {return;}
        try {
            await Linking.openURL(releaseUrl);
        } catch {
            // ignore
        }
    }, [releaseUrl]);

    const handleInstallCached = useCallback(async () => {
        if (!cachedApk) {return;}
        const opened = await openInstaller(cachedApk.path, cachedApk.fileName);
        if (!opened && releaseUrl) {
            handleOpenRelease();
        }
    }, [cachedApk, handleOpenRelease, openInstaller, releaseUrl]);

    const handleDownloadAndInstall = useCallback(async () => {
        if (!apkUrl || isDownloading) {return;}
        try {
            setIsDownloading(true);
            setDownloadProgress(0);

            const versionTag = latestVersion || 'update';
            const fileName = `Glide-${versionTag}.apk`;
            const targetPath = `${RNFS.CachesDirectoryPath}/${fileName}`;

            const download = RNFS.downloadFile({
                fromUrl: apkUrl,
                toFile: targetPath,
                progressDivider: 1,
                progress: (res) => {
                    if (res.contentLength > 0) {
                        const pct = Math.round((res.bytesWritten / res.contentLength) * 100);
                        setDownloadProgress(pct);
                    }
                },
            });

            const result = await download.promise;
            if (result.statusCode !== 200) {
                throw new Error('Download failed');
            }

            await updateStorage.save({
                version: normalizeVersion(versionTag),
                path: targetPath,
                fileName,
                savedAt: Date.now(),
            });
            setCachedApk({
                version: normalizeVersion(versionTag),
                path: targetPath,
                fileName,
                savedAt: Date.now(),
            });

            const opened = await openInstaller(targetPath, fileName);
            if (!opened && releaseUrl) {
                handleOpenRelease();
            }
        } catch (error) {
            if (__DEV__) {
                console.warn('[useUpdateInstaller] Download/Install failed:', error);
            }
            if (releaseUrl) {
                handleOpenRelease();
            }
        } finally {
            setIsDownloading(false);
            setDownloadProgress(null);
        }
    }, [apkUrl, handleOpenRelease, isDownloading, latestVersion, openInstaller, releaseUrl]);

    return {
        canDownload,
        cachedApk,
        downloadProgress,
        hasCachedApk,
        isDownloading,
        handleDownloadAndInstall,
        handleInstallCached,
        handleOpenRelease,
    };
}
