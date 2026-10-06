import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { metrics, type } from '@/theme/theme';
import { Button, Sheet } from '@/components/ui';
import { UpdateActionButton, UpdateNotice } from '@/components/UpdateActionButton';
import { useUpdateInstaller } from '@/hooks/useUpdateInstaller';
import { UpdateNotes } from '@/components/UpdateNotes';

interface UpdateModalProps {
    visible: boolean;
    latestVersion: string | null;
    releaseNotes: string | null;
    releaseUrl: string | null;
    apkUrl: string | null;
    apkSha256Url: string | null;
    onDismiss: () => void;
}

export default function UpdateModal({
    visible,
    latestVersion,
    releaseNotes,
    releaseUrl,
    apkUrl,
    apkSha256Url,
    onDismiss,
}: UpdateModalProps) {
    const { colors } = useTheme();
    const {
        canDownload,
        unavailableReason,
        downloadProgress,
        error,
        handleCancelDownload,
        clearError,
        hasCachedApk,
        isDownloading,
        handleDownloadAndInstall,
        handleInstallCached,
        handleOpenRelease,
    } = useUpdateInstaller({ latestVersion, releaseUrl, apkUrl, apkSha256Url });

    // A failure from a previous attempt should not greet the next open.
    useEffect(() => {
        if (visible) {
            clearError();
        }
    }, [clearError, visible]);

    return (
        <Sheet visible={visible} onClose={onDismiss}>
            <View style={styles.header}>
                <Text style={[type.section, { color: colors.text }]}>Update available</Text>
                <Text style={[type.caption, { color: colors.textSecondary }]}>
                    {latestVersion ? `Version ${latestVersion}` : 'A new version is ready'}
                </Text>
            </View>

            <UpdateNotes notes={releaseNotes} />

            <UpdateNotice error={error} unavailableReason={unavailableReason} />

            <View style={styles.actions}>
                <UpdateActionButton
                    canDownload={canDownload}
                    downloadProgress={downloadProgress}
                    error={error}
                    onCancelDownload={handleCancelDownload}
                    hasCachedApk={hasCachedApk}
                    isDownloading={isDownloading}
                    onDownloadAndInstall={handleDownloadAndInstall}
                    onInstallCached={handleInstallCached}
                    onOpenRelease={handleOpenRelease}
                />
                {!isDownloading && <Button variant="ghost" label="Not now" onPress={onDismiss} size="lg" />}
            </View>
        </Sheet>
    );
}

const styles = StyleSheet.create({
    header: { marginBottom: metrics.space.lg, gap: 2 },
    actions: { gap: metrics.space.sm },
});
