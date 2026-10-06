// src/components/VideoOptionsBottomSheet.tsx
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { FFprobeKit } from 'react-native-ffmpeg-kit';
import { useTheme } from '@/hooks/useTheme';
import { VideoFile, VideoHistoryEntry } from '@/types';
import { formatDuration, formatFileSize } from '@/utils/formatUtils';
import { useThumbnail } from '@/hooks/useThumbnails';
import { ListGroup, ListRow, Sheet } from '@/components/ui';
import { metrics, type } from '@/theme/theme';

interface VideoOptionsProps {
    visible: boolean;
    video: VideoFile | VideoHistoryEntry | null;
    onClose: () => void;
    onPlay: () => void;
    onShare: () => void;
    onDelete: () => void;
    onClearHistory?: () => void;
}

interface ExtendedMeta {
    bitrate?: string;
    video?: string;
    audio?: string;
    subtitles?: string;
    loading: boolean;
}

const SUBTITLE_CODEC_NAMES: Record<string, string> = {
    subrip: 'SRT',
    hdmv_pgs_subtitle: 'PGS',
    ass: 'SSA',
    mov_text: 'MOV',
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
    const { colors } = useTheme();

    const path = video ? ('path' in video ? video.path : video.videoPath) : '';
    const name = video ? ('name' in video ? video.name : video.videoName) : '';
    const duration = video ? video.duration : 0;
    const size = video && 'size' in video ? video.size : (video && 'fileSize' in video ? video.fileSize : 0);
    const date = video && 'modifiedDate' in video ? video.modifiedDate : (video && 'lastWatchedTime' in video ? video.lastWatchedTime : 0);
    const dateLabel = video && 'lastWatchedTime' in video ? 'Watched' : 'Modified';
    const resolution = video && 'width' in video && video.width && video.height ? `${video.width} × ${video.height}` : null;
    const folder = path.split('/').slice(0, -1).pop();

    const { thumbnail } = useThumbnail(path);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [extendedMeta, setExtendedMeta] = useState<ExtendedMeta>({ loading: false });

    useEffect(() => {
        if (!visible) {
            setDetailsOpen(false);
            return;
        }
        if (!path) {return;}
        let cancelled = false;
        setExtendedMeta({ loading: true });

        FFprobeKit.getMediaInformation(path).then((session) => {
            const information = session.getMediaInformation();
            if (cancelled) {return;}
            if (!information) {
                setExtendedMeta({ loading: false });
                return;
            }

            let videoInfo = '';
            let audioInfo = '';
            const subtitleTracks: { lang: string; codec: string }[] = [];

            information.getStreams().forEach((stream: any) => {
                if (stream.getType() === 'video') {
                    // r_frame_rate is a fraction like "30000/1001" or a plain number.
                    const rFrameRate: string | undefined = stream.getRealFrameRate();
                    let fps = '';
                    if (rFrameRate) {
                        const [num, den] = rFrameRate.split('/');
                        fps = `${(parseFloat(num) / (den ? parseFloat(den) : 1)).toFixed(0)} fps`;
                    }
                    videoInfo = [String(stream.getCodec() ?? '').toUpperCase(), fps].filter(Boolean).join(' · ');
                } else if (stream.getType() === 'audio') {
                    const rate = stream.getSampleRate() ? `${parseInt(stream.getSampleRate(), 10) / 1000} kHz` : '';
                    audioInfo = [String(stream.getCodec() ?? '').toUpperCase(), rate].filter(Boolean).join(' · ');
                } else if (stream.getType() === 'subtitle') {
                    const codec = String(stream.getCodec() ?? '');
                    const tags = stream.getTags();
                    subtitleTracks.push({
                        lang: tags && tags.language ? tags.language.toUpperCase() : 'UND',
                        codec: (SUBTITLE_CODEC_NAMES[codec] ?? codec).toUpperCase(),
                    });
                }
            });

            let bitrate = '';
            const bitrateVal = information.getBitrate();
            if (bitrateVal) {
                const bps = parseInt(bitrateVal, 10);
                bitrate = bps > 1000000 ? `${(bps / 1000000).toFixed(1)} Mbps` : `${(bps / 1000).toFixed(0)} Kbps`;
            }

            // "ENG, JPN · SRT / PGS"
            const subtitles = subtitleTracks.length > 0
                ? `${[...new Set(subtitleTracks.map(t => t.lang))].join(', ')} · ${[...new Set(subtitleTracks.map(t => t.codec))].join(' / ')}`
                : undefined;

            setExtendedMeta({
                bitrate: bitrate || undefined,
                video: videoInfo || undefined,
                audio: audioInfo || undefined,
                subtitles,
                loading: false,
            });
        }).catch(() => {
            if (!cancelled) {setExtendedMeta({ loading: false });}
        });

        return () => { cancelled = true; };
    }, [visible, path]);

    const formattedDate = useMemo(() => {
        if (!date) { return null; }
        return new Date(date).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }, [date]);


    if (!video) { return null; }

    const handleAction = (action: () => void) => {
        onClose();
        setTimeout(action, 250);
    };

    const metaLine = [duration ? formatDuration(duration) : null, size ? formatFileSize(size) : null, folder]
        .filter(Boolean)
        .join(' · ');

    const details: [string, string | null | undefined][] = [
        ['Duration', duration ? formatDuration(duration) : null],
        ['Size', size ? formatFileSize(size) : null],
        [dateLabel, formattedDate],
        ['Resolution', resolution],
        ['Video', extendedMeta.video],
        ['Audio', extendedMeta.audio],
        ['Bitrate', extendedMeta.bitrate],
        ['Subtitles', extendedMeta.subtitles],
        ['Folder', folder],
    ];

    return (
        <Sheet visible={visible} onClose={onClose}>
            <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.header}>
                    <View style={[styles.thumbnail, { backgroundColor: colors.surfaceVariant }]}>
                        {thumbnail ? (
                            <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        ) : (
                            <Feather name="film" size={20} color={colors.textTertiary} />
                        )}
                    </View>
                    <View style={styles.headerText}>
                        <Text style={[type.heading, { color: colors.text }]} numberOfLines={2}>{name}</Text>
                        {!!metaLine && (
                            <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>{metaLine}</Text>
                        )}
                    </View>
                </View>

                <ListGroup inset>
                    <ListRow icon="play" title="Play" onPress={() => handleAction(onPlay)} />
                    <ListRow icon="share-2" title="Share" onPress={() => handleAction(onShare)} />
                    {onClearHistory && (
                        <ListRow icon="x-circle" title="Remove from Recents" onPress={() => handleAction(onClearHistory)} />
                    )}
                    <ListRow icon="trash-2" title="Delete from device" destructive onPress={() => handleAction(onDelete)} />
                </ListGroup>

                <ListGroup inset style={styles.details}>
                    <ListRow
                        title="Details"
                        onPress={() => setDetailsOpen(open => !open)}
                        trailing={<Feather name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />}
                    />
                    {detailsOpen && details.filter(([, value]) => !!value).map(([label, value]) => (
                        <ListRow key={label} title={label} value={value ?? undefined} />
                    ))}
                    {detailsOpen && extendedMeta.loading && <ListRow title="Reading file…" />}
                </ListGroup>
            </ScrollView>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: metrics.space.md,
        paddingBottom: metrics.space.lg,
    },
    thumbnail: {
        width: 96,
        aspectRatio: 16 / 9,
        borderRadius: metrics.radius.sm,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerText: { flex: 1, gap: 4 },
    details: { marginTop: metrics.space.md },
});
