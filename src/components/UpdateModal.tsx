import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Linking,
    Platform,
} from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { useTheme } from '@/hooks/useTheme';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';
import pkg from '../../package.json';
import { compareVersions, normalizeVersion } from '@/utils/version';
import { updateStorage, UpdateApkCache } from '@/storage/updateStorage';

interface UpdateModalProps {
    visible: boolean;
    latestVersion: string | null;
    releaseNotes: string | null;
    releaseUrl: string | null;
    apkUrl: string | null;
    onDismiss: () => void;
}

function formatNotes(notes: string | null): string {
    if (!notes) {return 'No changelog provided.';}
    return notes.trim();
}

export default function UpdateModal({
    visible,
    latestVersion,
    releaseNotes,
    releaseUrl,
    apkUrl,
    onDismiss,
}: UpdateModalProps) {
    const theme = useTheme();
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const [cachedApk, setCachedApk] = useState<UpdateApkCache | null>(null);

    const displayNotes = useMemo(() => formatNotes(releaseNotes), [releaseNotes]);
    const canDownload = Boolean(apkUrl);
    const hasCachedApk = Boolean(cachedApk?.path);
    const currentVersion = normalizeVersion(String(pkg.version || '0.0.0'));

    const safeDeleteFile = useCallback(async (filePath?: string | null) => {
        if (!filePath) {return;}
        try {
            const exists = await RNFS.exists(filePath);
            if (exists) {
                await RNFS.unlink(filePath);
            }
        } catch (error) {
            if (__DEV__) {
                console.warn('[UpdateModal] Failed to delete cached APK:', error);
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

            // If app is already at or above cached version, delete the file.
            if (compareVersions(currentVersion, cached.version) >= 0) {
                await safeDeleteFile(cached.path);
                await updateStorage.clear();
                if (isActive) {setCachedApk(null);}
                return;
            }

            // If a newer update is available, remove old cached APK.
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
    }, [latestVersion, currentVersion, safeDeleteFile]);

    const openInstaller = useCallback(async (filePath: string, fileName: string) => {
        const fileUrl = Platform.OS === 'android'
            ? `file://${filePath}`
            : filePath;

        if (Platform.OS === 'android') {
            try {
                await Share.open({
                    url: fileUrl,
                    type: 'application/vnd.android.package-archive',
                    filename: fileName,
                    failOnCancel: false,
                });
                return true;
            } catch (error) {
                if (__DEV__) {
                    console.warn('[UpdateModal] Share install failed:', error);
                }
            }
        }

        try {
            await Linking.openURL(fileUrl);
            return true;
        } catch (error) {
            if (__DEV__) {
                console.warn('[UpdateModal] Linking install failed:', error);
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
                progressDivider: 5,
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
                console.warn('[UpdateModal] Download/Install failed:', error);
            }
            if (releaseUrl) {
                handleOpenRelease();
            }
        } finally {
            setIsDownloading(false);
            setDownloadProgress(null);
        }
    }, [apkUrl, handleOpenRelease, isDownloading, latestVersion, openInstaller, releaseUrl]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onDismiss}
            statusBarTranslucent
            navigationBarTranslucent
            presentationStyle="overFullScreen"
        >
            <View style={styles.backdrop}>
                <View style={[styles.card, { backgroundColor: theme.colors.card }]}>
                    <View style={styles.header}>
                        <View style={[styles.iconWrap, { backgroundColor: theme.colors.cardElevated }]}>
                            <Feather name="download" size={18} color={theme.colors.text} />
                        </View>
                        <View style={styles.headerText}>
                            <Text style={[styles.title, { color: theme.colors.text }]}>
                                New update available
                            </Text>
                            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                                {latestVersion ? `Version ${latestVersion}` : 'A new version is ready'}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.notesBlock}>
                        <Text style={[styles.notesTitle, { color: theme.colors.text }]}>
                            What’s new
                        </Text>
                        <ScrollView style={styles.notesScroll} showsVerticalScrollIndicator={false}>
                            <Text style={[styles.notesText, { color: theme.colors.textSecondary }]}>
                                {displayNotes}
                            </Text>
                        </ScrollView>
                    </View>

                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={[styles.dismissButton, { borderColor: theme.colors.border }]}
                            onPress={onDismiss}
                            activeOpacity={0.8}
                        >
                            <Text style={[styles.dismissText, { color: theme.colors.text }]}>Dismiss</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]}
                            onPress={
                                hasCachedApk
                                    ? handleInstallCached
                                    : (canDownload ? handleDownloadAndInstall : handleOpenRelease)
                            }
                            activeOpacity={0.85}
                            disabled={isDownloading}
                        >
                            {isDownloading ? (
                                <View style={styles.downloadRow}>
                                    <ActivityIndicator color="#000" size="small" />
                                    <Text style={styles.primaryText}>
                                        {downloadProgress !== null ? `Downloading ${downloadProgress}%` : 'Downloading...'}
                                    </Text>
                                </View>
                            ) : (
                                <Text style={styles.primaryText}>
                                    {hasCachedApk
                                        ? 'Install Update'
                                        : (canDownload ? 'Download & Install' : 'Open Release')}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    card: {
        width: '100%',
        borderRadius: 20,
        padding: 18,
        maxHeight: '80%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    iconWrap: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    headerText: {
        flex: 1,
    },
    title: {
        fontSize: 16,
        fontWeight: '700',
    },
    subtitle: {
        marginTop: 2,
        fontSize: 12,
    },
    notesBlock: {
        flex: 1,
        marginBottom: 16,
    },
    notesTitle: {
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 8,
    },
    notesScroll: {
        maxHeight: 220,
    },
    notesText: {
        fontSize: 12,
        lineHeight: 18,
    },
    actions: {
        flexDirection: 'row',
        gap: 12,
    },
    dismissButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dismissText: {
        fontSize: 12,
        fontWeight: '700',
    },
    primaryButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#000',
    },
    downloadRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
});
