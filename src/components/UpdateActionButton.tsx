import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/hooks/useTheme';
import type { UpdateError } from '@/hooks/useUpdateInstaller';

interface UpdateActionButtonProps {
    canDownload: boolean;
    downloadProgress: number | null;
    error?: UpdateError | null;
    onCancelDownload?: () => void;
    hasCachedApk: boolean;
    isDownloading: boolean;
    onDownloadAndInstall: () => void;
    onInstallCached: () => void;
    onOpenRelease: () => void;
    style?: ViewStyle;
}

export function UpdateActionButton({
    canDownload,
    downloadProgress,
    error,
    hasCachedApk,
    isDownloading,
    onCancelDownload,
    onDownloadAndInstall,
    onInstallCached,
    onOpenRelease,
    style,
}: UpdateActionButtonProps) {
    const theme = useTheme();
    const progressAnim = useSharedValue(0);
    const [buttonWidth, setButtonWidth] = React.useState<number | null>(null);
    const fillColor = theme.dark ? '#FFFFFF' : '#000000';
    const baseTextColor = theme.dark ? '#FFFFFF' : '#000000';
    const fillTextColor = fillColor === '#FFFFFF' ? '#000000' : '#FFFFFF';

    useEffect(() => {
        if (downloadProgress !== null && downloadProgress >= 0) {
            progressAnim.value = withTiming(downloadProgress / 100, { duration: 300 });
        } else {
            progressAnim.value = 0;
        }
    }, [downloadProgress, progressAnim]);

    const progressFillStyle = useAnimatedStyle(() => ({
        width: `${progressAnim.value * 100}%`,
    }));

    const progressClipStyle = useAnimatedStyle(() => ({
        width: `${progressAnim.value * 100}%`,
    }));


    // An error that a browser download can work around turns the button into that
    // explicit fallback; everything else keeps the retry action it already had.
    const showReleaseFallback = !canDownload || Boolean(error?.canOpenRelease);
    const label = showReleaseFallback
        ? 'Open Release'
        : (hasCachedApk ? 'Install Update' : 'Download');
    const action = showReleaseFallback
        ? onOpenRelease
        : (hasCachedApk ? onInstallCached : onDownloadAndInstall);

    // Say why the in-app download is unavailable instead of silently offering a browser.
    const notice = error?.message
        ?? (!canDownload ? 'This release has no verified download for your device.' : null);

    return (
        <View style={style}>
            {notice ? (
                <Text style={[styles.noticeText, { color: theme.dark ? '#FCA5A5' : '#B91C1C' }]}>
                    {notice}
                </Text>
            ) : null}
        <TouchableOpacity
            style={[
                styles.primaryButton,
                isDownloading
                    ? { backgroundColor: theme.dark ? '#2A2A2A' : '#F0F0F0' }
                    : { backgroundColor: theme.dark ? '#FFFFFF' : '#000000' },
            ]}
            onLayout={(event) => setButtonWidth(event.nativeEvent.layout.width)}
            onPress={action}
            activeOpacity={isDownloading ? 1 : 0.85}
            disabled={isDownloading}
        >
            {isDownloading ? (
                <>
                    <Animated.View
                        style={[
                            styles.progressFill,
                            { backgroundColor: fillColor },
                            progressFillStyle,
                        ]}
                    />
                    <View style={styles.progressLabel}>
                        <Text style={[styles.primaryText, { color: baseTextColor }]}>
                            {downloadProgress !== null ? `Downloading ${downloadProgress}%` : 'Downloading...'}
                        </Text>
                    </View>
                    <Animated.View style={[styles.progressTextClip, progressClipStyle]}>
                        <View
                            style={[
                                styles.progressTextInner,
                                buttonWidth ? { width: buttonWidth } : null,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.primaryText,
                                    { color: fillTextColor },
                                ]}
                                numberOfLines={1}
                            >
                                {downloadProgress !== null ? `Downloading ${downloadProgress}%` : 'Downloading...'}
                            </Text>
                        </View>
                    </Animated.View>
                </>
            ) : (
                <Text style={[styles.primaryText, { color: fillTextColor }]}>{label}</Text>
            )}
        </TouchableOpacity>
            {isDownloading && onCancelDownload ? (
                <TouchableOpacity onPress={onCancelDownload} activeOpacity={0.7} style={styles.cancel}>
                    <Text style={[styles.cancelText, { color: theme.dark ? '#A0A0A0' : '#6B7280' }]}>
                        Cancel
                    </Text>
                </TouchableOpacity>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    primaryButton: {
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        minHeight: 44,
    },
    primaryText: {
        fontSize: 14,
        fontWeight: '700',
        textAlign: 'center',
    },
    noticeText: {
        fontSize: 12,
        lineHeight: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    cancel: {
        alignSelf: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        marginTop: 4,
    },
    cancelText: {
        fontSize: 13,
        fontWeight: '600',
    },
    progressFill: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        borderRadius: 12,
    },
    progressLabel: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    progressTextClip: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        overflow: 'hidden',
    },
    progressTextInner: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
