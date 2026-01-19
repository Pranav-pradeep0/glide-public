// src/components/VideoOptionsBottomSheet.tsx
import React, { useMemo, useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    ScrollView,
    Image,
    Pressable,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import FastImage from 'react-native-fast-image';
import { useTheme } from '@/hooks/useTheme';
import { VideoFile, VideoHistoryEntry } from '@/types';
import { formatFileSize } from '@/utils/formatUtils';
import { useThumbnail } from '@/hooks/useThumbnails';

interface VideoOptionsProps {
    visible: boolean;
    video: VideoFile | VideoHistoryEntry | null;
    onClose: () => void;
    onPlay: () => void;
    onShare: () => void;
    onDelete: () => void;
    onClearHistory?: () => void;
}

const MetadataItem = ({
    icon,
    label,
    value,
    theme
}: {
    icon: string;
    label: string;
    value: string;
    theme: any;
}) => (
    <View style={styles.metaItem}>
        <View style={[styles.metaIcon, { backgroundColor: theme.colors.surfaceVariant }]}>
            <Feather name={icon as any} size={16} color={theme.colors.textSecondary} />
        </View>
        <View>
            <Text style={[styles.metaLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
            <Text style={[styles.metaValue, { color: theme.colors.text }]}>{value}</Text>
        </View>
    </View>
);

const ActionButton = ({
    icon,
    label,
    color,
    onPress,
    danger = false,
    theme
}: {
    icon: string;
    label: string;
    color?: string;
    onPress: () => void;
    danger?: boolean;
    theme: any;
}) => (
    <TouchableOpacity
        style={[styles.actionButton, { backgroundColor: theme.colors.surface }]}
        onPress={onPress}
        activeOpacity={0.7}
    >
        <View style={[
            styles.actionIcon,
            { backgroundColor: danger ? 'rgba(255,59,48,0.1)' : theme.colors.surfaceVariant }
        ]}>
            <Feather
                name={icon as any}
                size={22}
                color={danger ? theme.colors.error : (color || theme.colors.text)}
            />
        </View>
        <Text style={[
            styles.actionLabel,
            { color: danger ? theme.colors.error : theme.colors.text }
        ]}>
            {label}
        </Text>
        <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
    </TouchableOpacity>
);

const formatDurationLocal = (sec: number) => {
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = Math.floor(sec % 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    return `${minutes}m ${seconds}s`;
};

export const VideoOptionsBottomSheet: React.FC<VideoOptionsProps> = ({
    visible,
    video,
    onClose,
    onPlay,
    onShare,
    onDelete,
    onClearHistory,
}) => {
    const theme = useTheme();

    const path = video ? ('path' in video ? video.path : video.videoPath) : '';
    const name = video ? ('name' in video ? video.name : video.videoName) : '';
    const duration = video ? video.duration : 0;
    const size = video && 'size' in video ? video.size : (video && 'fileSize' in video ? video.fileSize : 0);
    const date = video && 'modifiedDate' in video ? video.modifiedDate : (video && 'lastWatchedTime' in video ? video.lastWatchedTime : 0);
    const dateLabel = video && 'lastWatchedTime' in video ? 'Watched' : 'Modified';

    const { thumbnail } = useThumbnail(path, duration);
    const [aspectRatio, setAspectRatio] = useState<number>(1.77);
    const [isPortrait, setIsPortrait] = useState(false);

    useEffect(() => {
        if (thumbnail) {
            Image.getSize(thumbnail, (width, height) => {
                const ratio = width / height;
                setAspectRatio(ratio);
                setIsPortrait(height > width);
            }, (err) => {
                console.log('Failed to get image size', err);
            });
        }
    }, [thumbnail]);

    const formattedDate = useMemo(() => {
        if (!date) return 'Unknown';
        return new Date(date).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }, [date]);

    if (!video) return null;

    const handleAction = (action: () => void) => {
        onClose();
        setTimeout(action, 250);
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent
            navigationBarTranslucent
        >
            <View style={styles.modalContainer}>
                {/* Backdrop - only closes when tapped */}
                <Pressable style={styles.backdrop} onPress={onClose} />

                {/* Sheet content - does NOT close when tapped */}
                <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
                    <View style={styles.handleContainer}>
                        <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
                    </View>

                    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                        <View style={styles.topHeader}>
                            <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={2}>
                                {name}
                            </Text>
                            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                                {path.split('/').slice(0, -1).pop()}
                            </Text>
                        </View>

                        {isPortrait ? (
                            <View style={styles.portraitLayout}>
                                <View style={[styles.portraitThumbnailWrapper, { backgroundColor: theme.colors.surfaceVariant }]}>
                                    {thumbnail ? (
                                        <FastImage
                                            source={{ uri: thumbnail }}
                                            style={StyleSheet.absoluteFill}
                                            resizeMode={FastImage.resizeMode.cover}
                                        />
                                    ) : (
                                        <Feather name="video" size={32} color={theme.colors.textSecondary} />
                                    )}
                                    <View style={styles.playOverlay}>
                                        <Feather name="play-circle" size={32} color="rgba(255,255,255,0.8)" />
                                    </View>
                                </View>
                                <View style={styles.portraitDetails}>
                                    <MetadataItem icon="clock" label="Duration" value={formatDurationLocal(duration)} theme={theme} />
                                    <View style={{ height: 12 }} />
                                    {size ? <MetadataItem icon="hard-drive" label="Size" value={formatFileSize(size)} theme={theme} /> : null}
                                    <View style={{ height: 12 }} />
                                    <MetadataItem icon="calendar" label={dateLabel} value={formattedDate} theme={theme} />
                                </View>
                            </View>
                        ) : (
                            <View style={styles.landscapeLayout}>
                                <View style={[styles.landscapeThumbnailWrapper, { backgroundColor: theme.colors.surfaceVariant, aspectRatio: aspectRatio || 1.77 }]}>
                                    {thumbnail ? (
                                        <FastImage
                                            source={{ uri: thumbnail }}
                                            style={StyleSheet.absoluteFill}
                                            resizeMode={FastImage.resizeMode.contain}
                                        />
                                    ) : (
                                        <Feather name="video" size={48} color={theme.colors.textSecondary} />
                                    )}
                                    <View style={styles.playOverlay}>
                                        <Feather name="play-circle" size={48} color="rgba(255,255,255,0.8)" />
                                    </View>
                                </View>
                                <View style={[styles.metaGrid, { backgroundColor: theme.colors.surface }]}>
                                    <View style={styles.metaRow}>
                                        <MetadataItem icon="clock" label="Duration" value={formatDurationLocal(duration)} theme={theme} />
                                        {size ? <MetadataItem icon="hard-drive" label="Size" value={formatFileSize(size)} theme={theme} /> : null}
                                    </View>
                                    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
                                    <View style={styles.metaRow}>
                                        <MetadataItem icon="calendar" label={dateLabel} value={formattedDate} theme={theme} />
                                    </View>
                                </View>
                            </View>
                        )}

                        <View style={styles.actions}>
                            <ActionButton icon="play" label="Play Video" onPress={() => handleAction(onPlay)} theme={theme} color={theme.colors.primary} />
                            <ActionButton icon="share-2" label="Share File" onPress={() => handleAction(onShare)} theme={theme} />
                            <View style={{ height: 12 }} />
                            {onClearHistory && (
                                <ActionButton icon="slash" label="Remove from History" onPress={() => handleAction(onClearHistory)} theme={theme} danger />
                            )}
                            <ActionButton icon="trash-2" label="Delete from Device" onPress={() => handleAction(onDelete)} theme={theme} danger />
                        </View>
                        <View style={{ height: 40 }} />
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalContainer: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    sheet: {
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        maxHeight: '90%',
        minHeight: '60%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 10,
    },
    handleContainer: {
        alignItems: 'center',
        paddingVertical: 12,
        marginBottom: 8,
    },
    handle: {
        width: 48,
        height: 5,
        borderRadius: 3,
    },
    content: {
        paddingHorizontal: 24,
        paddingBottom: 20,
    },
    topHeader: {
        marginBottom: 24,
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        marginBottom: 4,
        lineHeight: 28,
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 14,
        fontWeight: '500',
    },
    portraitLayout: {
        flexDirection: 'row',
        marginBottom: 32,
        gap: 20,
    },
    portraitThumbnailWrapper: {
        width: 120,
        aspectRatio: 9 / 16,
        borderRadius: 16,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    portraitDetails: {
        flex: 1,
        justifyContent: 'center',
    },
    landscapeLayout: {
        marginBottom: 32,
    },
    landscapeThumbnailWrapper: {
        width: '100%',
        borderRadius: 20,
        overflow: 'hidden',
        marginBottom: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    playOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    metaGrid: {
        borderRadius: 20,
        padding: 20,
    },
    metaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 16,
    },
    metaItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    metaIcon: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    metaLabel: {
        fontSize: 12,
        marginBottom: 2,
        fontWeight: '500',
    },
    metaValue: {
        fontSize: 14,
        fontWeight: '700',
    },
    divider: {
        height: 1,
        marginVertical: 16,
        opacity: 0.5,
    },
    actions: {
        gap: 10,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 18,
    },
    actionIcon: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    actionLabel: {
        flex: 1,
        fontSize: 17,
        fontWeight: '600',
    },
});
