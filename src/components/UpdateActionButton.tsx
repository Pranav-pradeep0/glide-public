import React, { useEffect } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '@/hooks/useTheme';
import { metrics, motion, type } from '@/theme/theme';
import { Button, Touchable } from '@/components/ui';
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

const HEIGHT = 48;

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
    const { colors } = useTheme();
    const progressAnim = useSharedValue(0);
    const [buttonWidth, setButtonWidth] = React.useState<number | null>(null);

    useEffect(() => {
        if (downloadProgress !== null && downloadProgress >= 0) {
            progressAnim.value = withSpring(downloadProgress / 100, motion.press);
        } else {
            progressAnim.value = 0;
        }
    }, [downloadProgress, progressAnim]);

    // The fill and the clip that reveals the inverted label grow together.
    const progressStyle = useAnimatedStyle(() => ({
        width: `${progressAnim.value * 100}%`,
    }));

    // An error that a browser download can work around turns the button into that
    // explicit fallback; everything else keeps the retry action it already had.
    const showReleaseFallback = !canDownload || Boolean(error?.canOpenRelease);
    const label = showReleaseFallback
        ? 'Download in browser'
        : (hasCachedApk ? 'Install update' : 'Download');
    const action = showReleaseFallback
        ? onOpenRelease
        : (hasCachedApk ? onInstallCached : onDownloadAndInstall);
    const progressLabel = downloadProgress !== null ? `Downloading ${downloadProgress}%` : 'Downloading…';

    return (
        <View style={style}>
            <Touchable
                style={[styles.primaryButton, { backgroundColor: isDownloading ? colors.fill : colors.primary }]}
                onLayout={(event) => setButtonWidth(event.nativeEvent.layout.width)}
                onPress={action}
                disabled={isDownloading}
                accessibilityRole="button"
                accessibilityLabel={isDownloading ? progressLabel : label}
                accessibilityState={{ busy: isDownloading }}
            >
                {isDownloading ? (
                    <>
                        <Animated.View style={[styles.progressFill, { backgroundColor: colors.primary }, progressStyle]} />
                        <View style={styles.progressLabel}>
                            <Text style={[type.label, { color: colors.text }]}>{progressLabel}</Text>
                        </View>
                        <Animated.View style={[styles.progressTextClip, progressStyle]}>
                            <View style={[styles.progressTextInner, buttonWidth ? { width: buttonWidth } : null]}>
                                <Text style={[type.label, { color: colors.onPrimary }]} numberOfLines={1}>
                                    {progressLabel}
                                </Text>
                            </View>
                        </Animated.View>
                    </>
                ) : (
                    <Text style={[type.label, { color: colors.onPrimary }]} numberOfLines={1}>{label}</Text>
                )}
            </Touchable>
            {isDownloading && onCancelDownload ? (
                <Button variant="ghost" label="Cancel" onPress={onCancelDownload} accessibilityLabel="Cancel download" style={styles.cancel} />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    primaryButton: {
        height: HEIGHT,
        paddingHorizontal: 18,
        borderRadius: HEIGHT / 2,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    noticeText: {
        ...type.caption,
        lineHeight: 17,
        marginBottom: metrics.space.md,
    },
    cancel: { alignSelf: 'center', marginTop: metrics.space.xs },
    progressFill: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
    },
    progressLabel: {
        ...StyleSheet.absoluteFill,
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

/**
 * Why the in-app download is unavailable, or what just went wrong. Rendered by the
 * surfaces rather than by the button: in the modal the button shares a row with Dismiss
 * and carries flex: 1, so anything inside it is confined to half the width.
 */
export function UpdateNotice({ error, unavailableReason }: {
    error?: UpdateError | null;
    unavailableReason?: string | null;
}) {
    const { colors } = useTheme();
    const text = error?.message ?? unavailableReason ?? null;
    if (!text) {
        return null;
    }
    return <Text style={[styles.noticeText, { color: colors.error }]}>{text}</Text>;
}
