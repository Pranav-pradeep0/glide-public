import React, { FC, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, Dimensions, useWindowDimensions } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { EdgeInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Rect, Path, Circle, G } from 'react-native-svg';
import {
    ContainIcon, CoverIcon, StretchIcon, FillIcon,
    PipIcon, AudioIcon, SubtitleIcon, BookmarkListIcon,
    OrientationLockIcon, BackgroundPlayIcon, NightModeIcon,
    HapticsIcon, VisualEnhancementIcon,
    getResizeModeIcon
} from './PlayerIcons';
import Animated, {
    useAnimatedProps,
    useSharedValue,
    useAnimatedStyle,
    SharedValue,
    runOnJS,
    useDerivedValue,
    withTiming
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// ============================================================================
// REANIMATED TEXT (High Performance Strings)
// ============================================================================

Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

interface ReanimatedTextProps {
    value: SharedValue<number>;
    formatter?: (val: number) => string;
    style?: any;
    prefix?: string;
}

const ReanimatedText: React.FC<ReanimatedTextProps> = ({ value, formatter, style, prefix = '' }) => {
    const animatedProps = useAnimatedProps(() => {
        const valStr = formatter ? formatter(value.value) : String(Math.round(value.value));
        return {
            text: prefix + valStr,
        } as any;
    });

    return (
        <AnimatedTextInput
            underlineColorAndroid="transparent"
            editable={false}
            value={prefix + (formatter ? formatter(value.value) : String(value.value))}
            style={[styles.reanimatedText, style]}
            animatedProps={animatedProps}
        />
    );
};

// ============================================================================
// SCRUBBER (Custom slider for video)
// ============================================================================

interface ScrubberProps {
    currentTime: SharedValue<number>;
    duration: SharedValue<number>;
    isScrubbing: SharedValue<boolean>;
    scrubPosition: SharedValue<number>; // Passed down for sync with text
    onSeekStart: () => void;
    onSeek: (val: number) => void;
    onSeekComplete: (val: number) => void;
}

const Scrubber: React.FC<ScrubberProps> = ({
    currentTime,
    duration,
    isScrubbing,
    scrubPosition,
    onSeekStart,
    onSeek,
    onSeekComplete
}) => {
    const { width: screenWidth } = useWindowDimensions();
    const trackWidth = useSharedValue(0);
    // Time-based throttling for JS callbacks
    const lastUpdateJS = useSharedValue(0);
    // scrubPosition is now passed as prop

    const progress = useDerivedValue(() => {
        const d = duration.value || 1;
        // Check for 0 duration to avoid NaN
        if (d <= 0) return 0;
        // Use scrubPosition during scrub, currentTime otherwise
        const time = isScrubbing.value ? scrubPosition.value : currentTime.value;
        return Math.max(0, Math.min(1, time / d));
    });

    const trackHeight = useDerivedValue(() => {
        return withTiming(isScrubbing.value ? 4 : 2, { duration: 200 });
    });

    const trackRadius = useDerivedValue(() => {
        return withTiming(isScrubbing.value ? 5 : 2, { duration: 150 });
    });

    const trackTop = useDerivedValue(() => {
        return (40 - trackHeight.value) / 2;
    });

    const progressStyle = useAnimatedStyle(() => {
        return {
            // Optimize: Use translateX (GPU) instead of width (Layout) for butter smooth animation
            // Slide in from left (-100% to 0%)
            transform: [
                { translateX: (progress.value - 1) * trackWidth.value }
            ],
            // Full width to match container
            width: trackWidth.value,
            height: trackHeight.value,
            borderRadius: trackRadius.value,
            top: trackTop.value,
        };
    });

    const backgroundStyle = useAnimatedStyle(() => {
        return {
            height: trackHeight.value,
            borderRadius: trackRadius.value,
            top: trackTop.value,
        };
    });

    const panGesture = Gesture.Pan()
        .onBegin((e) => {
            'worklet';
            isScrubbing.value = true;

            if (trackWidth.value > 0) {
                const newProgress = Math.max(0, Math.min(1, e.x / trackWidth.value));
                const targetTime = newProgress * (duration.value || 0);
                scrubPosition.value = targetTime;
                runOnJS(onSeekStart)();
                // Ensure HUD and other listeners are updated immediately
                runOnJS(onSeek)(targetTime);
            }
        })
        .onUpdate((e) => {
            'worklet';
            if (trackWidth.value <= 0) return;

            const newProgress = Math.max(0, Math.min(1, e.x / trackWidth.value));


            const targetTime = newProgress * (duration.value || 0);
            scrubPosition.value = targetTime;

            // Throttle JS updates by time (max 25 updates per second) to keep UI thread silky
            // The slider animation (scrubPosition) remains 60/120fps
            const now = Date.now();
            if (now - lastUpdateJS.value > 40) {
                lastUpdateJS.value = now;
                runOnJS(onSeek)(targetTime);
            }
        })
        .onFinalize(() => {
            'worklet';
            const finalTime = scrubPosition.value;
            // Keep scrubbing flag true until seek completes to prevent snapback
            runOnJS(onSeekComplete)(finalTime);
            lastUpdateJS.value = 0;
        });

    return (
        <GestureDetector gesture={panGesture}>
            <Animated.View
                style={styles.scrubberContainer}
                onLayout={(e) => { trackWidth.value = e.nativeEvent.layout.width; }}
                hitSlop={{ top: 20, bottom: 20 }}
            >
                <Animated.View style={[styles.trackBackground, backgroundStyle]} />
                <Animated.View style={[styles.trackFill, progressStyle]} />
            </Animated.View>
        </GestureDetector>
    );
};

// ============================================================================
// DISPLAY MODE ICONS
// ============================================================================



// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface PlayerControlsProps {
    showControls: boolean;
    title: string;
    onBack: () => void;
    onToggleAudio: () => void;
    onToggleSubtitle: () => void;
    onAddBookmark?: () => void;
    paused: boolean;
    onTogglePlayPause: () => void;
    currentTime: SharedValue<number>;
    duration: SharedValue<number>;
    isScrubbingShared: SharedValue<boolean>;
    onSeekStart: () => void;
    onSeek: (val: number) => void;
    onSeekComplete: (val: number) => void;
    errorText: string | null;
    isLandscape: boolean;
    insets: EdgeInsets;
    audioTrackSelected: boolean;
    subtitleTrackSelected: boolean;
    formatTime?: (seconds: number) => string;
    onToggleBookmarkPanel?: () => void;
    onTogglePlaylist?: () => void;
    onToggleQuickSettings?: () => void;
    onNext?: () => void;
    onPrev?: () => void;
    onJumpBackward: () => void;
    onJumpForward: () => void;
    onToggleLock: () => void;
    isLocked: boolean;
    onToggleResizeMode: () => void;
    resizeMode: string;
    onToggleNightMode: () => void;
    nightModeActive: boolean;
    playMode?: string;
    playbackRate: number;
    onToggleSpeed: () => void;
    onToggleHaptics: () => void;
    hapticsEnabled: boolean;
    onToggleBackgroundPlay?: () => void;
    backgroundPlayEnabled?: boolean;
    onEnterPip?: () => void;
    videoEnhancement?: boolean;
    onToggleVideoEnhancement?: () => void;
    // Seek button customization
    showSeekButtons?: boolean;
    seekDuration?: number;
}

export const PlayerControls: FC<PlayerControlsProps> = React.memo(({
    showControls, title, onBack, onToggleAudio, onToggleSubtitle,
    onAddBookmark, paused, onTogglePlayPause, currentTime, duration,
    onSeekStart, onSeek, onSeekComplete, errorText, isLandscape, insets,
    audioTrackSelected, subtitleTrackSelected, isScrubbingShared,
    onToggleBookmarkPanel, onTogglePlaylist, onToggleQuickSettings,
    onNext, onPrev, onJumpBackward, onJumpForward,
    onToggleLock, isLocked, onToggleResizeMode, resizeMode,
    onToggleNightMode, nightModeActive, playMode, playbackRate, onToggleSpeed, onToggleHaptics, hapticsEnabled,
    onToggleBackgroundPlay, backgroundPlayEnabled, onEnterPip,
    videoEnhancement, onToggleVideoEnhancement,
    showSeekButtons = false, seekDuration = 30
}) => {
    // Worklet-safe time formatter
    const timeFormatter = (val: number) => {
        'worklet';
        const seconds = Math.floor(val);
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        const mm = m < 10 ? `0${m}` : `${m}`;
        const ss = s < 10 ? `0${s}` : `${s}`;
        const h = Math.floor(m / 60);

        if (h > 0) {
            const hh = h;
            const mmRem = m % 60;
            const mmStr = mmRem < 10 ? `0${mmRem}` : `${mmRem}`;
            return `${hh}:${mmStr}:${ss}`;
        }
        return `${mm}:${ss}`;
    };

    // Calculate remaining time
    const remainingTimeValue = useDerivedValue(() => {
        return Math.max(0, duration.value - currentTime.value);
    });

    // Create a local scrub position shared value to coordinate slider and text
    const scrubPosition = useSharedValue(0);

    // Derived display time: shows scrub position while dragging, current time otherwise
    // This allows immediate visual feedback on the text without waiting for VLC
    const displayTime = useDerivedValue(() => {
        return isScrubbingShared.value ? scrubPosition.value : currentTime.value;
    });

    // Sync scrubPosition with currentTime when not scrubbing (optional, but good for safety)
    // Actually not needed as we switch source based on flag

    // Get the appropriate icon for current resize mode
    const ResizeModeIcon = getResizeModeIcon(resizeMode);

    if (!showControls) return null;

    return (
        <View style={styles.controlsOverlay} pointerEvents="box-none">
            {/* Header */}
            <LinearGradient
                colors={['rgba(0,0,0,0.8)', 'rgba(0,0,0,0.4)', 'transparent']}
                style={[
                    styles.header,
                    isLandscape && styles.headerLandscape,
                    { paddingTop: Math.max(insets.top, 16) }
                ]}
            >
                <Pressable onPress={onBack} style={styles.backButton} hitSlop={10}>
                    <Feather name="arrow-left" size={24} color="#fff" />
                </Pressable>
                <Text numberOfLines={1} style={styles.title}>{title || 'Video'}</Text>

                {/* Header Icons (Right) */}
                <View style={styles.headerIcons}>
                    {onToggleVideoEnhancement && isLandscape && (
                        <Pressable onPress={onToggleVideoEnhancement} style={styles.iconButton} hitSlop={10}>
                            <VisualEnhancementIcon size={22} color="#fff" active={videoEnhancement} />
                        </Pressable>
                    )}
                    <Pressable onPress={onToggleAudio} style={styles.iconButton} hitSlop={10}>
                        <AudioIcon size={23} color="#fff" />
                    </Pressable>
                    <Pressable onPress={onToggleSubtitle} style={styles.iconButton} hitSlop={10}>
                        <SubtitleIcon size={23} color="#fff" />
                    </Pressable>
                    {onAddBookmark && (
                        <Pressable onPress={onAddBookmark} style={styles.iconButton} hitSlop={10}>
                            <Feather name="bookmark" size={23} color="#fff" />
                        </Pressable>
                    )}

                    {onToggleBookmarkPanel && (
                        <Pressable onPress={onToggleBookmarkPanel} style={styles.iconButton} hitSlop={10}>
                            <BookmarkListIcon size={23} color="#fff" />
                        </Pressable>
                    )}
                    {onTogglePlaylist && (
                        <Pressable onPress={onTogglePlaylist} style={styles.iconButton} hitSlop={10}>
                            <Feather name="list" size={23} color="#fff" />
                        </Pressable>
                    )}
                    {/* Quick Settings */}
                    <Pressable
                        onPress={onToggleQuickSettings}
                        style={styles.iconButton}
                        hitSlop={10}
                    >
                        <Feather name="more-vertical" size={23} color="#fff" />
                    </Pressable>
                </View>
            </LinearGradient>

            {/* ERROR BAR */}
            {!!errorText && (
                <LinearGradient
                    colors={['rgba(220,38,38,0.9)', 'rgba(185,28,28,0.85)']}
                    style={[styles.errorBar, { top: 70 + insets.top }]}
                >
                    <Text style={styles.errorText} numberOfLines={2}>{errorText}</Text>
                </LinearGradient>
            )}

            {/* CONTROLS CONTAINER (Bottom 33%) */}
            {/* Visual Gradient (Pointer Events None) */}
            <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.9)']}
                style={[
                    styles.bottomGradient,
                    { paddingBottom: Math.max(insets.bottom, 16) }
                ]}
                pointerEvents="none"
            />

            {/* Interactive Controls (Pointer Events Box-None) */}
            <View
                style={[
                    styles.bottomControlsContainer,
                    { paddingBottom: Math.max(insets.bottom, 16) }
                ]}
                pointerEvents="box-none"
            >
                {/* 1. SCRUBBER ROW (Full Width) */}
                <View style={styles.scrubberRow}>
                    <Scrubber
                        currentTime={currentTime}
                        duration={duration}
                        isScrubbing={isScrubbingShared}
                        scrubPosition={scrubPosition}
                        onSeekStart={onSeekStart}
                        onSeek={onSeek}
                        onSeekComplete={onSeekComplete}
                    />
                </View>

                {/* 2. TIME ROW (Between Scrubber and Buttons) */}
                <View style={styles.timeRow}>
                    <ReanimatedText
                        value={displayTime}
                        formatter={timeFormatter}
                        style={styles.timeText}
                    />
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <ReanimatedText
                            value={remainingTimeValue}
                            formatter={timeFormatter}
                            prefix="-"
                            style={[styles.timeText, { color: '#ccc', }]}
                        />
                        <Text style={[styles.timeText, { color: '#ccc' }]}> / </Text>
                        <ReanimatedText
                            value={duration}
                            formatter={timeFormatter}
                            style={[styles.timeText, { color: '#fff' }]}
                        />
                    </View>
                </View>

                {/* 3. BUTTONS ROW */}
                <View style={styles.buttonsRow}>

                    {/* Orientation Lock Button */}
                    <Pressable onPress={onToggleLock} style={styles.controlBtnSmall}>
                        <OrientationLockIcon size={20} color={isLocked ? "#FBBF24" : "#fff"} locked={isLocked} />
                    </Pressable>

                    {isLandscape && onToggleBackgroundPlay && (
                        <Pressable onPress={onToggleBackgroundPlay} style={styles.controlBtnSmall} hitSlop={10}>
                            <BackgroundPlayIcon size={20} color={backgroundPlayEnabled ? '#FBBF24' : '#fff'} />
                        </Pressable>
                    )}

                    {/* Contextual: Haptics/Speed (Hidden in Portrait) */}
                    {isLandscape && (
                        playMode === 'with-haptics' ? (
                            <Pressable onPress={onToggleHaptics} style={styles.controlBtnSmall}>
                                <HapticsIcon size={20} color={hapticsEnabled ? '#fff' : '#a0a0a0ff'} active={hapticsEnabled} />
                            </Pressable>
                        ) : (
                            <Pressable onPress={onToggleSpeed} style={styles.controlBtnSmall}>
                                <Text style={styles.speedText}>{playbackRate}x</Text>
                            </Pressable>
                        )
                    )}

                    {/* Jump Back */}
                    {showSeekButtons && (
                        <Pressable onPress={onJumpBackward} style={styles.controlBtnKey}>
                            <Feather name="rotate-ccw" size={22} color="#fff" />
                            <Text style={styles.jumpText}>{seekDuration}</Text>
                        </Pressable>
                    )}

                    {/* Prev */}
                    <Pressable
                        onPress={onPrev}
                        style={[styles.controlBtnKey, !onPrev && { opacity: 0.3 }]}
                        disabled={!onPrev}
                    >
                        <Feather name="skip-back" size={28} color="#fff" />
                    </Pressable>

                    {/* PLAY/PAUSE (Main) */}
                    <Pressable onPress={onTogglePlayPause} style={styles.playPauseBtnParams}>
                        <Feather name={paused ? 'play' : 'pause'} size={isLandscape ? 40 : 32} color="#fff" />
                    </Pressable>

                    {/* Next */}
                    <Pressable
                        onPress={onNext}
                        style={[styles.controlBtnKey, !onNext && { opacity: 0.3 }]}
                        disabled={!onNext}
                    >
                        <Feather name="skip-forward" size={28} color="#fff" />
                    </Pressable>

                    {/* Jump Fwd */}
                    {showSeekButtons && (
                        <Pressable onPress={onJumpForward} style={styles.controlBtnKey}>
                            <Feather name="rotate-cw" size={22} color="#fff" />
                            <Text style={styles.jumpText}>{seekDuration}</Text>
                        </Pressable>
                    )}

                    {/* Resize Mode - Now with dynamic icons */}
                    {isLandscape && (
                        <Pressable onPress={onToggleResizeMode} style={styles.controlBtnSmall}>
                            <ResizeModeIcon size={20} color="#fff" />
                        </Pressable>
                    )}

                    {onEnterPip && isLandscape && (
                        <Pressable onPress={onEnterPip} style={styles.controlBtnSmall} hitSlop={10}>
                            <PipIcon size={20} color="#fff" />
                        </Pressable>
                    )}

                    {/* Night Mode */}
                    <Pressable onPress={onToggleNightMode} style={styles.controlBtnSmall}>
                        <NightModeIcon size={20} color={nightModeActive ? "#FBBF24" : "#fff"} active={nightModeActive} />
                    </Pressable>
                </View>
            </View>
        </View>
    );
}, (prev, next) => {
    return (
        prev.showControls === next.showControls &&
        prev.paused === next.paused &&
        prev.title === next.title &&
        prev.errorText === next.errorText &&
        prev.isLandscape === next.isLandscape &&
        prev.insets === next.insets &&
        prev.audioTrackSelected === next.audioTrackSelected &&
        prev.subtitleTrackSelected === next.subtitleTrackSelected &&
        prev.isLocked === next.isLocked &&
        prev.resizeMode === next.resizeMode &&
        prev.nightModeActive === next.nightModeActive &&
        prev.playbackRate === next.playbackRate &&
        prev.onNext === next.onNext &&
        prev.onPrev === next.onPrev &&
        prev.hapticsEnabled === next.hapticsEnabled &&
        prev.backgroundPlayEnabled === next.backgroundPlayEnabled &&
        prev.videoEnhancement === next.videoEnhancement
    );
});

PlayerControls.displayName = 'PlayerControls';

const styles = StyleSheet.create({
    controlsOverlay: {
        position: 'absolute',
        top: 0, bottom: 0, left: 0, right: 0,
        justifyContent: 'space-between',
        zIndex: 10,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    headerLandscape: {
        paddingTop: 16,
    },
    backButton: { padding: 8 },
    title: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        flex: 1,
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    headerIcons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    iconButton: {
        padding: 8,
    },
    iconBadge: {
        position: 'absolute',
        bottom: 4, right: 4,
        backgroundColor: '#fff',
        borderRadius: 6,
        width: 12, height: 12,
        justifyContent: 'center', alignItems: 'center',
    },
    // BOTTOM CONTROLS
    bottomGradient: {
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: 200,
        justifyContent: 'flex-end',
        paddingTop: 40,
    },
    bottomControlsContainer: {
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        paddingHorizontal: 20,
        justifyContent: 'flex-end',
    },
    scrubberRow: {
        height: 44,
        justifyContent: 'center',
        marginBottom: -8,
    },
    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 4,
    },
    buttonsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
        minHeight: 48,
    },
    // Button Styles
    controlBtnKey: {
        padding: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    controlBtnSmall: {
        padding: 10,
        opacity: 0.9,
    },
    playPauseBtnParams: {
        width: 56, height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 8,
        elevation: 5,
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 }
    },
    jumpText: {
        position: 'absolute',
        fontSize: 8,
        fontWeight: 'bold',
        color: '#fff',
        marginTop: 1,
    },
    speedText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 13,
    },
    timeText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '500',
        fontVariant: ['tabular-nums'],
    },
    // Existing Styles (kept for compatibility if needed)
    centerControls: { display: 'none' },
    bottomBar: { display: 'none' },
    bottomBarLandscape: {},
    sliderContainer: {},
    scrubberContainer: { height: 40, justifyContent: 'center', overflow: 'hidden' },
    trackBackground: { backgroundColor: 'rgba(255,255,255,0.2)', width: '100%', position: 'absolute' },
    trackFill: { backgroundColor: '#fff', position: 'absolute', left: 0 },
    reanimatedText: { color: '#fff', fontSize: 13, includeFontPadding: false },
    errorBar: { position: 'absolute', left: 16, right: 16, padding: 12, borderRadius: 8, zIndex: 99 },
    errorText: { color: '#fff', fontWeight: 'bold' },
});