import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TouchableWithoutFeedback,
    BackHandler,
} from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withSpring,
    runOnJS,
} from 'react-native-reanimated';
import { Feather } from '@react-native-vector-icons/feather';
import { useTheme } from '@/hooks/useTheme';
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
    const theme = useTheme();
    const [mounted, setMounted] = useState(false);

    // Reanimated Shared Values
    const fadeAnim = useSharedValue(0);
    const scaleAnim = useSharedValue(0.9);
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

    // Animated Styles
    const backdropStyle = useAnimatedStyle(() => ({
        opacity: fadeAnim.value,
    }));

    const cardStyle = useAnimatedStyle(() => ({
        opacity: fadeAnim.value,
        transform: [{ scale: scaleAnim.value }],
    }));

    // Entrance/Exit Animations
    useEffect(() => {
        if (visible) {
            setMounted(true);
            fadeAnim.value = withTiming(1, { duration: 250 });
            scaleAnim.value = withSpring(1, { damping: 15, stiffness: 100 });
        } else if (mounted) {
            fadeAnim.value = withTiming(0, { duration: 200 }, (finished) => {
                if (finished) runOnJS(setMounted)(false);
            });
            scaleAnim.value = withTiming(0.9, { duration: 200 });
        }
    }, [visible, mounted, fadeAnim, scaleAnim]);

    // A failure from a previous attempt should not greet the next open.
    useEffect(() => {
        if (visible) {
            clearError();
        }
    }, [clearError, visible]);

    // Handle Android back button
    useEffect(() => {
        if (!visible) {return;}

        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            onDismiss();
            return true;
        });

        return () => handler.remove();
    }, [visible, onDismiss]);

    if (!mounted) {
        return null;
    }

    const cardBg = theme.dark ? '#1A1A1A' : '#FFFFFF';
    const cardBorder = theme.dark ? '#333333' : '#E5E7EB';
    const textColor = theme.dark ? '#FFFFFF' : '#000000';
    const textSecondaryColor = theme.dark ? '#A0A0A0' : '#6B7280';
    const iconBg = theme.dark ? '#2A2A2A' : '#F3F4F6';

    return (
        <Animated.View
            style={[
                StyleSheet.absoluteFill,
                styles.backdrop,
                backdropStyle,
            ]}
            pointerEvents={visible ? 'auto' : 'none'}
        >
            <TouchableWithoutFeedback onPress={onDismiss}>
                <View style={StyleSheet.absoluteFill} />
            </TouchableWithoutFeedback>

            <Animated.View
                style={[
                    styles.card,
                    {
                        backgroundColor: cardBg,
                        borderColor: cardBorder,
                        borderWidth: 1,
                    },
                    cardStyle,
                ]}
            >
                <View style={styles.header}>
                    <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
                        <Feather name="download" size={18} color={textColor} />
                    </View>
                    <View style={styles.headerText}>
                        <Text style={[styles.title, { color: textColor }]}>
                            New update available
                        </Text>
                        <Text style={[styles.subtitle, { color: textSecondaryColor }]}>
                            {latestVersion ? `Version ${latestVersion}` : 'A new version is ready'}
                        </Text>
                    </View>
                </View>

                <UpdateNotes notes={releaseNotes} />

                <UpdateNotice error={error} unavailableReason={unavailableReason} />

                <View style={styles.actions}>
                    {!isDownloading && (
                        <TouchableOpacity
                            style={[styles.dismissButton, { borderColor: cardBorder }]}
                            onPress={onDismiss}
                            activeOpacity={0.8}
                        >
                            <Text style={[styles.dismissText, { color: textColor }]}>Dismiss</Text>
                        </TouchableOpacity>
                    )}

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
                        style={styles.primaryButton}
                    />
                </View>
            </Animated.View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 9999,
        elevation: 9999,
    },
    card: {
        width: '100%',
        maxWidth: 420,
        borderRadius: 20,
        padding: 20,
        elevation: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 24,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    iconWrap: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    headerText: {
        flex: 1,
    },
    title: {
        fontSize: 17,
        fontWeight: '700',
    },
    subtitle: {
        marginTop: 2,
        fontSize: 13,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 12,
    },
    dismissButton: {
        flex: 1,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dismissText: {
        fontSize: 14,
        fontWeight: '700',
    },
    primaryButton: {
        flex: 1,
    },
});
