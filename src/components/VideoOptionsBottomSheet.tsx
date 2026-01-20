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
import { FFprobeKit } from 'react-native-ffmpeg-kit';
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
    badge,
    theme
}: {
    icon: string;
    label: string;
    value: string;
    badge?: string;
    theme: any;
}) => (
    <View style={styles.metaItem}>
        <View style={[styles.metaIcon, { backgroundColor: theme.colors.surfaceVariant }]}>
            <Feather name={icon as any} size={16} color={theme.colors.textSecondary} />
        </View>
        <View style={{ flex: 1, flexShrink: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                <Text style={[styles.metaLabel, { color: theme.colors.textSecondary, marginBottom: 0 }]} numberOfLines={1}>{label}</Text>
                {badge && (
                    <View style={{ backgroundColor: theme.colors.surfaceVariant, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, marginLeft: 6 }}>
                        <Text style={{ fontSize: 10, color: theme.colors.text, fontWeight: '700' }}>{badge}</Text>
                    </View>
                )}
            </View>
            <Text style={[styles.metaValue, { color: theme.colors.text }]} numberOfLines={3}>{value}</Text>
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
    const resolution = video && 'width' in video && video.width && video.height ? `${video.width} x ${video.height}` : null;

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

    // Extended Metadata State
    const [extendedMeta, setExtendedMeta] = useState<{
        bitrate?: string;
        videoCodec?: string;
        audioCodec?: string;
        fps?: string;
        sampleRate?: string;
        subtitles?: string;
        subtitleBadge?: string;
        loading: boolean;
    }>({ loading: false });

    useEffect(() => {
        if (visible && path) {
            setExtendedMeta(prev => ({ ...prev, loading: true }));

            FFprobeKit.getMediaInformation(path).then(async (session) => {
                const information = session.getMediaInformation();
                if (information) {
                    const props = information.getAllProperties();

                    // Extract streams
                    const streams = information.getStreams();
                    let videoCodec = '';
                    let audioCodec = '';
                    let fps = '';
                    let sampleRate = '';
                    const subtitleTracks: { lang: string; codec: string }[] = [];

                    streams.forEach((stream: any) => {
                        if (stream.getType() === 'video') {
                            videoCodec = stream.getCodec();
                            // FPS calculation from r_frame_rate (e.g., "30000/1001" or "30/1")
                            const rFrameRate = stream.getRealFrameRate();
                            if (rFrameRate) {
                                // Simple check if it's a fraction or number
                                if (rFrameRate.includes('/')) {
                                    const [num, den] = rFrameRate.split('/');
                                    const calculated = parseInt(num) / parseInt(den);
                                    fps = calculated.toFixed(0) + ' fps';
                                } else {
                                    fps = parseFloat(rFrameRate).toFixed(0) + ' fps';
                                }
                            }
                        } else if (stream.getType() === 'audio') {
                            audioCodec = stream.getCodec();
                            sampleRate = stream.getSampleRate() ? `${parseInt(stream.getSampleRate()) / 1000} kHz` : '';
                        } else if (stream.getType() === 'subtitle') {
                            const codec = stream.getCodec();
                            const tags = stream.getTags();
                            // Try to get language, default to 'und' (VideoOptionsBottomSheet.tsx) or just codec
                            let lang = tags && tags.language ? tags.language.toUpperCase() : 'UND';

                            // Map common codecs to friendly names if needed
                            let friendlyCodec = codec;
                            if (codec === 'subrip') friendlyCodec = 'SRT';
                            if (codec === 'hdmv_pgs_subtitle') friendlyCodec = 'PGS';
                            if (codec === 'ass') friendlyCodec = 'SSA';
                            if (codec === 'mov_text') friendlyCodec = 'MOV';


                            subtitleTracks.push({ lang, codec: friendlyCodec.toUpperCase() });
                        }
                    });

                    // Bitrate
                    const bitrateVal = information.getBitrate(); // in bps
                    let bitrate = '';
                    if (bitrateVal) {
                        const bps = parseInt(bitrateVal);
                        if (bps > 1000000) {
                            bitrate = (bps / 1000000).toFixed(1) + ' Mbps';
                        } else {
                            bitrate = (bps / 1000).toFixed(0) + ' Kbps';
                        }
                    }

                    // Format Subtitles and Badge
                    let subtitlesStr = '';
                    let subtitleBadge = '';

                    if (subtitleTracks.length > 0) {
                        // Deduplicate formats for badge (e.g., "SRT / PGS")
                        const uniqueCodecs = [...new Set(subtitleTracks.map(t => t.codec))];
                        subtitleBadge = uniqueCodecs.join(' / ');

                        // Deduplicate languages for value (e.g., "ENG, JPN")
                        const uniqueLangs = [...new Set(subtitleTracks.map(t => t.lang))];
                        subtitlesStr = uniqueLangs.join(', ');
                    }

                    setExtendedMeta({
                        bitrate,
                        videoCodec: videoCodec.toUpperCase(),
                        audioCodec: audioCodec.toUpperCase(),
                        fps,
                        sampleRate,
                        subtitles: subtitlesStr || undefined,
                        subtitleBadge: subtitleBadge || undefined,
                        loading: false
                    });
                } else {
                    setExtendedMeta(prev => ({ ...prev, loading: false }));
                }
            });
        }
    }, [visible, path]);

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

                        <View style={styles.landscapeLayout}>
                            <View style={[styles.landscapeThumbnailWrapper, { backgroundColor: theme.colors.surfaceVariant, aspectRatio: 1.77 }]}>
                                {thumbnail ? (
                                    <>
                                        {/* Blurred Background for Portrait/Weird Aspect Ratios */}
                                        <Image
                                            source={{ uri: thumbnail }}
                                            style={StyleSheet.absoluteFill}
                                            resizeMode="cover"
                                            blurRadius={10}
                                        /><View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.51)' }} />

                                        {/* Playable Content */}
                                        <FastImage
                                            source={{ uri: thumbnail }}
                                            style={StyleSheet.absoluteFill}
                                            resizeMode={FastImage.resizeMode.contain}
                                        />
                                    </>
                                ) : (
                                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                        <Feather name="video" size={48} color={theme.colors.textSecondary} />
                                    </View>
                                )}
                                <Pressable style={styles.playOverlay} onPress={() => handleAction(onPlay)}>
                                    <Feather name="play-circle" size={48} color="rgba(255,255,255,0.9)" />
                                </Pressable>
                            </View>
                            <View style={[styles.metaGrid, { backgroundColor: theme.colors.surface }]}>
                                <View style={styles.metaRow}>
                                    <MetadataItem icon="clock" label="Duration" value={formatDurationLocal(duration)} theme={theme} />
                                    {size ? <MetadataItem icon="hard-drive" label="Size" value={formatFileSize(size)} theme={theme} /> : null}
                                </View>
                                <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
                                <View style={styles.metaRow}>
                                    <MetadataItem icon="calendar" label={dateLabel} value={formattedDate} theme={theme} />
                                    {resolution ? <MetadataItem icon="maximize" label="Resolution" value={resolution} theme={theme} /> : null}
                                </View>

                                {/* Extended Geeky Metadata Landscape */}
                                {!extendedMeta.loading && (extendedMeta.bitrate || extendedMeta.videoCodec || extendedMeta.audioCodec || extendedMeta.subtitles) && (
                                    <>
                                        <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
                                        <View style={styles.metaRow}>
                                            {extendedMeta.bitrate ? <MetadataItem icon="activity" label="Bitrate" value={extendedMeta.bitrate} theme={theme} /> : <View style={{ flex: 1 }} />}
                                            {extendedMeta.videoCodec ? <MetadataItem icon="film" label="Video" value={`${extendedMeta.videoCodec} ${extendedMeta.fps ? `(${extendedMeta.fps})` : ''}`} theme={theme} /> : <View style={{ flex: 1 }} />}
                                        </View>
                                        {(extendedMeta.audioCodec || extendedMeta.subtitles) && (
                                            <View style={{ marginTop: 16 }}>
                                                <View style={styles.metaRow}>
                                                    {extendedMeta.audioCodec ? <MetadataItem icon="music" label="Audio" value={`${extendedMeta.audioCodec} ${extendedMeta.sampleRate ? `(${extendedMeta.sampleRate})` : ''}`} theme={theme} /> : <View style={{ flex: 1 }} />}
                                                </View>
                                                {extendedMeta.subtitles ? (
                                                    <>
                                                        <View style={{ height: 16 }} />
                                                        <MetadataItem icon="message-square" label="Subtitles" badge={extendedMeta.subtitleBadge} value={extendedMeta.subtitles} theme={theme} />
                                                    </>
                                                ) : null}
                                            </View>
                                        )}
                                    </>
                                )}
                            </View>
                        </View>

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
        </Modal >
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
