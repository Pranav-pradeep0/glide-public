import React, { memo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import Slider from '@react-native-community/slider';
import { Feather } from '@react-native-vector-icons/feather';
import { PlayerResizeMode } from 'react-native-vlc-media-player';
import { AudioIcon, SubtitleIcon, BookmarkListIcon } from './PlayerIcons';
import { useAppStore } from '../../store/appStore';
import HapticModule from '../../native/HapticModule';
import Animated, {
    FadeIn,
    FadeOut,
    SlideInLeft,
    SlideOutLeft
} from 'react-native-reanimated';

import { useWindowDimensions } from 'react-native';

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
const DISPLAY_MODE_OPTIONS: Array<{ mode: PlayerResizeMode; label: string }> = [
    { mode: 'best-fit', label: 'BEST FIT' },
    { mode: 'contain', label: 'CONTAIN' },
    { mode: 'cover', label: 'COVER' },
    { mode: 'fill', label: 'FILL' },
    { mode: 'scale-down', label: 'SCALE DOWN' },
    { mode: 'none', label: 'NONE' },
    { mode: 'stretch', label: 'STRETCH' },
];
const SLEEP_TIMER_OPTIONS = [
    { label: 'Off', value: null },
    { label: '10m', value: 10 },
    { label: '20m', value: 20 },
    { label: '30m', value: 30 },
    { label: '60m', value: 60 },
    { label: 'End', value: -1 },
];

interface QuickSettingsPanelProps {
    onClose: () => void;
    playbackRate: number;
    onPlaybackRateChange: (rate: number) => void;
    muted: boolean;
    onToggleMute: () => void;
    repeat: boolean;
    onToggleRepeat: () => void;
    sleepTimer: number | null;
    onSetSleepTimer: (minutes: number | null) => void;
    decoder: 'hardware' | 'software' | 'hardware_plus';
    onSetDecoder: (mode: 'hardware' | 'software' | 'hardware_plus') => void;
    onOpenPlaylist: () => void;
    onOpenAudio: () => void;
    onOpenSubtitle: () => void;
    onOpenBookmarkPanel: () => void; // New Prop
    onAddBookmark: () => void;
    resizeMode: PlayerResizeMode;
    onSetResizeMode: (mode: PlayerResizeMode) => void;
    isLandscape: boolean;
    insets?: any;
    enableHaptics?: boolean;
}

export const QuickSettingsPanel: React.FC<QuickSettingsPanelProps> = memo((props) => {
    // Reactive Dimensions
    const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
    const isLandscape = SCREEN_WIDTH > SCREEN_HEIGHT;

    // Width Logic:
    // Landscape: 45% of screen (or min 400, max 600)
    // Portrait: 90% of screen (or min 350, max 450)
    const PANEL_WIDTH = isLandscape
        ? Math.min(500, Math.max(400, SCREEN_WIDTH * 0.40))
        : Math.min(480, SCREEN_WIDTH * 0.9);

    // Haptics
    const { settings, setHapticIntensity, toggleHaptics } = useAppStore();
    const { hapticSettings } = settings;
    const lastPreviewTime = useRef(0);

    const handleIntensityChange = useCallback((value: number) => {
        setHapticIntensity(value);
        const now = Date.now();
        if (now - lastPreviewTime.current > 150 && HapticModule) {
            lastPreviewTime.current = now;
            HapticModule.vibrate(50, Math.round(value));
        }
    }, [setHapticIntensity]);

    const handlePresetSelect = useCallback((value: number) => {
        setHapticIntensity(value);
        HapticModule?.vibrate(80, value);
    }, [setHapticIntensity]);

    return (
        <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
            {/* Backdrop */}
            <Animated.View
                entering={FadeIn.duration(200)}
                exiting={FadeOut.duration(200)}
                style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
            >
                <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
            </Animated.View>

            {/* Panel */}
            <Animated.View
                entering={SlideInLeft.duration(250)}
                exiting={SlideOutLeft.duration(250)}
                style={[
                    styles.panelContainer,
                    {
                        width: PANEL_WIDTH,
                        paddingTop: props.insets?.top || 0,
                        paddingBottom: props.insets?.bottom || 0,
                    }
                ]}
            >
                {/* Content */}
                <View style={styles.contentContainer}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.titleRow}>
                            <View style={styles.iconBadge}>
                                <Feather name="settings" size={20} color="#FFF" />
                            </View>
                            <Text style={styles.titleText}>Quick Settings</Text>
                        </View>
                        <Pressable
                            style={({ pressed }) => [styles.closeBtn, pressed && styles.opacityPressed]}
                            onPress={props.onClose}
                            hitSlop={15}
                        >
                            <Feather name="x" size={22} color="#FFF" />
                        </Pressable>
                    </View>

                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.scrollContent}
                    >
                        {/* HAPTICS SECTION */}
                        {props.enableHaptics && (
                            <View style={styles.section}>
                                <View style={styles.sectionHeaderRow}>
                                    <Text style={styles.sectionTitle}>HAPTICS</Text>
                                    <Pressable
                                        style={[styles.switch, hapticSettings.enabled && styles.switchActive]}
                                        onPress={toggleHaptics}
                                    >
                                        <View style={[styles.switchThumb, hapticSettings.enabled && styles.switchThumbActive]} />
                                    </Pressable>
                                </View>

                                <View style={[styles.card, !hapticSettings.enabled && styles.disabledOpacity]}>
                                    <View style={styles.sliderRow}>
                                        <Feather name="zap" size={18} color="rgba(255,255,255,0.5)" style={{ marginRight: 12 }} />
                                        <Slider
                                            style={{ flex: 1, height: 40 }}
                                            minimumValue={1}
                                            maximumValue={255}
                                            value={hapticSettings.intensity}
                                            onValueChange={handleIntensityChange}
                                            minimumTrackTintColor="#FFFFFF"
                                            maximumTrackTintColor="rgba(255,255,255,0.2)"
                                            thumbTintColor="#FFF"
                                            disabled={!hapticSettings.enabled}
                                        />
                                        <Text style={styles.valueText}>{Math.round(hapticSettings.intensity)}</Text>
                                    </View>
                                    <View style={styles.presetsContainer}>
                                        {[50, 120, 200].map((val, idx) => (
                                            <Pressable
                                                key={val}
                                                style={[
                                                    styles.presetChip,
                                                    hapticSettings.intensity === val && styles.activeChip
                                                ]}
                                                onPress={() => handlePresetSelect(val)}
                                                disabled={!hapticSettings.enabled}
                                            >
                                                <Text style={[
                                                    styles.chipText,
                                                    hapticSettings.intensity === val && styles.activeChipText
                                                ]}>
                                                    {['Light', 'Medium', 'Strong'][idx]}
                                                </Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                </View>
                            </View>
                        )}

                        {/* PLAYBACK SPEED */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>PLAYBACK SPEED</Text>
                            <View style={styles.gridContainer}>
                                {SPEED_OPTIONS.map(rate => (
                                    <Pressable
                                        key={rate}
                                        style={[
                                            styles.gridItem,
                                            props.playbackRate === rate && styles.activeGridItem
                                        ]}
                                        onPress={() => props.onPlaybackRateChange(rate)}
                                    >
                                        <Text style={[
                                            styles.gridItemText,
                                            props.playbackRate === rate && styles.activeGridItemText
                                        ]}>{rate}x</Text>
                                    </Pressable>
                                ))}
                            </View>
                        </View>

                        {/* RESIZE MODE */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>DISPLAY MODE</Text>
                            <View style={styles.gridContainer}>
                                {DISPLAY_MODE_OPTIONS.map(({ mode, label }) => (
                                    <Pressable
                                        key={mode}
                                        style={[
                                            styles.gridItem,
                                            props.resizeMode === mode && styles.activeGridItem, { justifyContent: 'center' }]}
                                        onPress={() => props.onSetResizeMode(mode)}
                                    >
                                        <Text style={[
                                            styles.gridItemText,
                                            props.resizeMode === mode && styles.activeGridItemText
                                        ]}>{label}</Text>
                                    </Pressable>
                                ))}
                            </View>
                        </View>

                        {/* TOOLS GRID */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>TOOLS</Text>
                            <View style={styles.rowLayout}>
                                <Pressable
                                    style={[styles.toolCard, props.muted && styles.activeToolCard]}
                                    onPress={props.onToggleMute}
                                >
                                    <View style={styles.iconCircle}>
                                        <Feather name={props.muted ? "volume-x" : "volume-2"} size={20} color={props.muted ? "#000" : "#FFF"} />
                                    </View>
                                    <Text style={[styles.toolLabel, props.muted && styles.activeToolLabel]}>Mute</Text>
                                </Pressable>
                                <Pressable
                                    style={[styles.toolCard, props.repeat && styles.activeToolCard]}
                                    onPress={props.onToggleRepeat}
                                >
                                    <View style={styles.iconCircle}>
                                        <Feather name="repeat" size={20} color={props.repeat ? "#000" : "#FFF"} />
                                    </View>
                                    <Text style={[styles.toolLabel, props.repeat && styles.activeToolLabel]}>Repeat</Text>
                                </Pressable>
                            </View>
                        </View>

                        {/* SLEEP TIMER */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>SLEEP TIMER</Text>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={{ gap: 10, paddingHorizontal: 24 }}
                                style={{ marginHorizontal: -24 }}
                            >
                                {SLEEP_TIMER_OPTIONS.map(opt => (
                                    <Pressable
                                        key={opt.label}
                                        style={[
                                            styles.capsuleTab,
                                            props.sleepTimer === opt.value && styles.activeCapsule
                                        ]}
                                        onPress={() => props.onSetSleepTimer(opt.value)}
                                    >
                                        <Text style={[
                                            styles.capsuleText,
                                            props.sleepTimer === opt.value && styles.activeCapsuleText
                                        ]}>{opt.label}</Text>
                                    </Pressable>
                                ))}
                            </ScrollView>
                        </View>

                        {/* DECODER */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>DECODER</Text>
                            <View style={styles.segmentContainer}>
                                {(['hardware', 'hardware_plus', 'software'] as const).map(mode => (
                                    <Pressable
                                        key={mode}
                                        style={[
                                            styles.segmentBtn,
                                            props.decoder === mode && styles.activeSegment
                                        ]}
                                        onPress={() => props.onSetDecoder(mode)}
                                    >
                                        <Text style={[
                                            styles.segmentText,
                                            props.decoder === mode && styles.activeSegmentText
                                        ]}>
                                            {mode === 'hardware_plus' ? 'HW+' : mode === 'hardware' ? 'HW' : 'SW'}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                        </View>

                        {/* ACTIONS LIST */}
                        <View style={[styles.section, { marginBottom: 60 }]}>
                            <Text style={styles.sectionTitle}>ACTIONS</Text>
                            {[
                                { label: 'Audio Track', icon: AudioIcon, onPress: props.onOpenAudio },
                                { label: 'Subtitles', icon: SubtitleIcon, onPress: props.onOpenSubtitle },
                                { label: 'Playlist', icon: Feather, iconName: 'list', onPress: props.onOpenPlaylist }, // Custom Icon
                                { label: 'Bookmarks', icon: BookmarkListIcon, onPress: props.onOpenBookmarkPanel }, // New Button
                                { label: 'Add Bookmark', icon: Feather, iconName: 'bookmark', onPress: props.onAddBookmark }, // Modified to avoid dupe icon usage if desired, or keep generic
                            ].map((item, i) => {
                                const Icon = item.icon as any;
                                return (
                                    <Pressable
                                        key={item.label}
                                        style={({ pressed }) => [styles.actionRow, pressed && styles.actionPressed]}
                                        onPress={item.onPress}
                                    >
                                        <View style={styles.actionIcon}>
                                            {item.iconName
                                                ? <Feather name={item.iconName as any} size={22} color="#FFF" />
                                                : <Icon size={22} color="#FFF" />
                                            }
                                        </View>
                                        <Text style={styles.actionLabel}>{item.label}</Text>
                                        <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.3)" />
                                    </Pressable>
                                );
                            })}
                        </View>

                    </ScrollView>
                </View>
            </Animated.View>
        </View>
    );
});

QuickSettingsPanel.displayName = 'QuickSettingsPanel';

const styles = StyleSheet.create({
    panelContainer: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        backgroundColor: 'rgba(12, 12, 12, 0.96)',
        borderRightWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        shadowColor: '#000',
        shadowOffset: { width: 10, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 30,
        elevation: 20,
    },
    contentContainer: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        paddingBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.06)',
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    iconBadge: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.08)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleText: {
        color: '#FFF',
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    closeBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    opacityPressed: {
        opacity: 0.7,
        backgroundColor: 'rgba(255,255,255,0.1)',
    },
    scrollContent: {
        paddingHorizontal: 24,
        paddingVertical: 20,
    },
    section: {
        marginBottom: 32,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    sectionTitle: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 12,
        fontWeight: '800',
        marginBottom: 12,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    card: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 16,
        padding: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
    },
    disabledOpacity: {
        opacity: 0.4,
    },
    switch: {
        width: 38,
        height: 18,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.15)',
        padding: 2,
        justifyContent: 'center',
    },
    switchActive: {
        backgroundColor: '#FFF',
    },
    switchThumb: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#000',
    },
    switchThumbActive: {
        alignSelf: 'flex-end',
        backgroundColor: '#000',
    },
    sliderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    valueText: {
        color: '#FFF',
        fontSize: 14,
        fontWeight: '700',
        width: 35,
        textAlign: 'right',
    },
    presetsContainer: {
        flexDirection: 'row',
        gap: 10,
    },
    presetChip: {
        flex: 1,
        backgroundColor: 'rgba(255,255,255,0.08)',
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    activeChip: {
        backgroundColor: '#FFF',
    },
    chipText: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 13,
        fontWeight: '600',
    },
    activeChipText: {
        color: '#000',
        fontWeight: '800',
    },
    gridContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    gridItem: {
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'transparent',
        padding: 8
    },
    activeGridItem: {
        backgroundColor: '#FFF',
        borderColor: '#FFF',
    },
    gridItemText: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 13,
        fontWeight: '600',
    },
    activeGridItemText: {
        color: '#000',
        fontWeight: '800',
    },
    rowLayout: {
        flexDirection: 'row',
        gap: 12,
    },
    toolCard: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        backgroundColor: 'rgba(255,255,255,0.06)',
        paddingVertical: 18, // Increased padding for better centering
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    activeToolCard: {
        backgroundColor: '#FFF',
    },
    iconCircle: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    toolLabel: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: '600',
        includeFontPadding: false, // Android specific fix for vertical alignment
        textAlignVertical: 'center',
    },
    activeToolLabel: {
        color: '#000',
    },
    capsuleTab: {
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 24,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
    },
    activeCapsule: {
        backgroundColor: '#FFF',
    },
    capsuleText: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 13,
        fontWeight: '600',
        includeFontPadding: false,
        textAlignVertical: 'center',
    },
    activeCapsuleText: {
        color: '#000',
        fontWeight: '800',
    },
    segmentContainer: {
        flexDirection: 'row',
        backgroundColor: 'rgba(0,0,0,0.4)',
        borderRadius: 14,
        padding: 5,
    },
    segmentBtn: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center', // Ensuring center
        paddingVertical: 12,
        borderRadius: 10,
    },
    activeSegment: {
        backgroundColor: 'rgba(255,255,255,0.15)',
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    segmentText: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 13,
        fontWeight: '600',
        includeFontPadding: false,
    },
    activeSegmentText: {
        color: '#FFF',
        fontWeight: '800',
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center', // Strict center alignment
        paddingVertical: 18, // Increased hit area
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.06)',
    },
    actionPressed: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 8,
    },
    actionIcon: {
        width: 36,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    actionLabel: {
        flex: 1,
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.3,
        includeFontPadding: false,
        textAlignVertical: 'center',
    },
});
