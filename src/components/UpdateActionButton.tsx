import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/hooks/useTheme';

interface UpdateActionButtonProps {
    canDownload: boolean;
    downloadProgress: number | null;
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
    hasCachedApk,
    isDownloading,
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


    return (
        <TouchableOpacity
            style={[
                styles.primaryButton,
                isDownloading
                    ? { backgroundColor: theme.dark ? '#2A2A2A' : '#F0F0F0' }
                    : { backgroundColor: theme.dark ? '#FFFFFF' : '#000000' },
                style,
            ]}
            onLayout={(event) => setButtonWidth(event.nativeEvent.layout.width)}
            onPress={
                hasCachedApk
                    ? onInstallCached
                    : (canDownload ? onDownloadAndInstall : onOpenRelease)
            }
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
                <Text style={[styles.primaryText, { color: fillTextColor }]}>
                    {hasCachedApk
                        ? 'Install Update'
                        : (canDownload ? 'Download' : 'Open Release')}
                </Text>
            )}
        </TouchableOpacity>
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
