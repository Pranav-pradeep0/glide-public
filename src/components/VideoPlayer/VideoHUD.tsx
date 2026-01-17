import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TextInput, useWindowDimensions } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import Animated, {
    useAnimatedProps,
    useDerivedValue,
    SharedValue,
    useAnimatedStyle,
    withTiming
} from 'react-native-reanimated';
import { DoubleTapRipple } from './DoubleTapRipple';
import { getResizeModeIcon, AnimatedVolumeIconStandard, AnimatedBrightnessIcon } from './PlayerIcons';

// Animated TextInput for high-performance text updates
Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

interface ReanimatedTextProps {
    value: SharedValue<number>;
    formatter?: (val: number) => string;
    style?: any;
}

const ReanimatedText: React.FC<ReanimatedTextProps> = ({ value, formatter, style }) => {
    const animatedProps = useAnimatedProps(() => {
        return {
            text: formatter ? formatter(value.value) : String(Math.round(value.value)),
        } as any;
    });

    return (
        <AnimatedTextInput
            underlineColorAndroid="transparent"
            editable={false}
            value={formatter ? formatter(value.value) : String(value.value)} // Initial value
            style={[styles.reanimatedText, style]}
            animatedProps={animatedProps}
        />
    );
};

interface VerticalHUDProps {
    value: SharedValue<number>;
    icon: any;
    side: 'left' | 'right';
    formatter: (val: number) => string;
    maxVolume?: number; // Added to support scaling
    isPortrait: boolean;
}

const VerticalHUD: React.FC<VerticalHUDProps> = React.memo(({ value, icon, side, formatter, maxVolume = 1.0, isPortrait }) => {

    const trackHeight = isPortrait ? 100 : 120;
    const trackWidth = isPortrait ? 4 : 6;
    const iconSize = isPortrait ? 24 : 32; // Smaller icon container in portrait
    const iconSvgSize = isPortrait ? 16 : 20;

    // Animate height based on percentage of max volume
    const animatedHeightStyle = useAnimatedStyle(() => {
        const percentage = Math.min(1, value.value / maxVolume);
        return {
            height: `${percentage * 100}%`,
            backgroundColor: value.value > 1.0 ? '#FF8C00' : '#fff',
        };
    });

    return (
        <View style={[
            styles.hudSide,
            side === 'left'
                ? { left: isPortrait ? 5 : 22 }
                : { right: isPortrait ? 5 : 22 },
            {
                // Dynamic vertical centering adjustment
                // Portrait height: Text(20) + Gap(8) + Track(80) + Gap(8) + Icon(24) = 140 -> -70
                // Landscape height: Text(20) + Gap(8) + Track(120) + Gap(8) + Icon(32) = 188 -> -94
                marginTop: isPortrait ? -70 : -94
            }
        ]} pointerEvents="none">
            <ReanimatedText
                value={value}
                formatter={formatter}
                style={[styles.verticalHudText, isPortrait ? { fontSize: 13, marginBottom: 2 } : {}]}
            />
            <View style={[styles.verticalTrack, { height: trackHeight, width: trackWidth }]}>
                <Animated.View style={[styles.verticalFill, animatedHeightStyle]} />
            </View>
            <View style={[styles.verticalIcon, { width: iconSize, height: iconSize, borderRadius: iconSize / 2 }]}>
                {icon === 'volume-2' ? (
                    <AnimatedVolumeIconStandard size={iconSvgSize} color="#fff" progress={value} maxVolume={maxVolume} />
                ) : (
                    <AnimatedBrightnessIcon size={iconSvgSize} color="#fff" progress={value} />
                )}
            </View>
        </View>
    );
});

interface VideoHUDProps {
    showSeekHUD: boolean;
    seekHUDTime: SharedValue<number>;
    seekStartTime: number;  // Start time for difference calculation
    seekDirection: 'forward' | 'backward' | null;
    seekSide: 'left' | 'right' | null;  // For opposite-side positioning on double-tap
    showBrightnessHUD: boolean;
    brightnessHUD: SharedValue<number>;
    showVolumeHUD: boolean;
    volumeHUD: SharedValue<number>;
    showSpeedHUD: boolean;
    playbackRate: number;
    // Resize HUD Props
    showResizeHUD: boolean;
    resizeMode: string;
    // Zoom HUD Props
    zoomActive: boolean;
    zoomHUDScale: number;
    shouldShowBuffer: boolean;
    formatTime: (seconds: number) => string;
    // Ripple props
    showRipple: boolean;
    rippleX: number;
    rippleY: number;
    rippleSide: 'left' | 'right';
    onRippleComplete?: () => void;
    maxVolume?: number;
}

// Helper to format time difference
const formatTimeDiff = (seconds: number): string => {
    'worklet';
    const absSeconds = Math.abs(Math.round(seconds));
    const sign = seconds >= 0 ? '+' : '-';

    // For values less than 10 minutes, show simple seconds (e.g., +60s, +90s)
    // This is preferred for jump buttons and quick seeks
    if (absSeconds < 60) {
        return `${sign}${absSeconds}s`;
    }

    // For larger values (long drags), show m:ss or h:mm:ss
    const m = Math.floor(absSeconds / 60);
    const s = absSeconds % 60;
    const ss = s < 10 ? `0${s}` : `${s}`;

    if (m >= 60) {
        const h = Math.floor(m / 60);
        const mm = (m % 60) < 10 ? `0${m % 60}` : `${m % 60}`;
        return `${sign}${h}:${mm}:${ss}`;
    }

    return `${sign}${m}:${ss}`;
};

export const VideoHUD: React.FC<VideoHUDProps> = React.memo(({
    showSeekHUD,
    seekHUDTime,
    seekStartTime,
    seekDirection,
    seekSide,
    showBrightnessHUD,
    brightnessHUD,
    showVolumeHUD,
    volumeHUD,
    showSpeedHUD,
    playbackRate,
    showResizeHUD,
    resizeMode,
    zoomActive,
    zoomHUDScale,
    shouldShowBuffer,
    formatTime,
    showRipple,
    rippleX,
    rippleY,
    rippleSide,
    onRippleComplete,
    maxVolume = 1.0, // Default to 1.0 (100%) if not provided
}) => {
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const isPortrait = screenHeight > screenWidth;

    // Formatters for worklet
    const percentageFormatter = (val: number) => {
        'worklet';
        return `${Math.round(val * 100)}%`;
    };

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

    // Calculate time difference for display
    const timeDiff = useMemo(() => {
        if (!showSeekHUD || seekStartTime === 0) return null;
        // We'll use the animated value's current snapshot for initial display
        // Actual updates are driven by the shared value
        return null; // Will be calculated in the animated text
    }, [showSeekHUD, seekStartTime]);

    // Time difference formatter that uses startTime
    const timeDiffFormatter = useMemo(() => {
        return (val: number) => {
            'worklet';
            if (seekStartTime === 0) return '';
            const diff = val - seekStartTime;
            return formatTimeDiff(diff);
        };
    }, [seekStartTime]);

    // Determine seek HUD position based on tap side
    // If tapped left, show on right side (and vice versa)
    // Use responsive percentages instead of fixed pixels
    // Adjust for portrait mode to ensure it's not too close to the edge
    const getSeekHUDPosition = () => {
        const sideOffset = isPortrait ? '10%' : '15%';

        if (seekSide === 'left') {
            return { right: sideOffset, left: undefined } as any;
        } else if (seekSide === 'right') {
            return { left: sideOffset, right: undefined } as any;
        }
        return {}; // Center (default for swipe/drag)
    };

    const seekHUDPositionStyle = useMemo(() => {
        if (seekSide) {
            return getSeekHUDPosition();
        }
        return {}; // Use default center positioning
    }, [seekSide]);

    // Get the appropriate icon for current resize mode
    const ResizeModeIcon = getResizeModeIcon(resizeMode);

    // Capitalize resize mode for display
    const resizeModeText = resizeMode ? (resizeMode.charAt(0).toUpperCase() + resizeMode.slice(1)) : 'Cover';

    return (
        <>
            {/* Water Ripple Effect */}
            <DoubleTapRipple
                show={showRipple}
                x={rippleX}
                y={rippleY}
                side={rippleSide}
                onAnimationComplete={onRippleComplete}
            />

            {/* Buffering Indicator */}
            {shouldShowBuffer && (
                <View style={styles.bufferOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color="#fff" />
                    {/* <Text style={styles.bufferText}>Buffering...</Text> */}
                </View>
            )}

            {/* Enhanced Seek HUD with time difference */}
            {showSeekHUD && (
                <View
                    style={[
                        seekSide ? styles.seekHUDSide : styles.hudCenter,
                        // Landscape needs to be higher (45%) due to tall bottom controls
                        // Portrait remains perfectly centered (50%)
                        { top: isPortrait ? '50%' : '45%' },
                        seekHUDPositionStyle
                    ]}
                    pointerEvents="none"
                >
                    <View style={styles.seekHUDPill}>
                        {/* Direction Icon */}
                        <Feather
                            name={seekDirection === 'backward' ? 'rewind' : 'fast-forward'}
                            size={18}
                            color="#fff"
                        />

                        {/* Time Difference (prominent) */}
                        {seekStartTime > 0 && (
                            <ReanimatedText
                                value={seekHUDTime}
                                formatter={timeDiffFormatter}
                                style={styles.timeDiffText}
                            />
                        )}

                        {/* Current Target Time */}
                        <ReanimatedText
                            value={seekHUDTime}
                            formatter={timeFormatter}
                            style={seekStartTime > 0 ? styles.targetTimeText : styles.hudText}
                        />
                    </View>
                </View>
            )}

            {/* Brightness HUD - Right side */}
            {showBrightnessHUD && (
                <VerticalHUD
                    value={brightnessHUD}
                    icon="sun"
                    side="right"
                    formatter={percentageFormatter}
                    isPortrait={isPortrait}
                />
            )}

            {/* Volume HUD - Left side */}
            {showVolumeHUD && (
                <VerticalHUD
                    value={volumeHUD}
                    icon="volume-2"
                    side="left"
                    formatter={percentageFormatter}
                    maxVolume={maxVolume}
                    isPortrait={isPortrait}
                />
            )}

            {/* Speed HUD */}
            {showSpeedHUD && Math.abs(playbackRate - 1.0) > 0.01 && (
                <View style={styles.speedHudTop} pointerEvents="none">
                    <View style={styles.speedHudPill}>
                        <Feather name="zap" size={14} color="#fff" />
                        <Text style={styles.speedHudText}>{playbackRate.toFixed(2)}x</Text>
                        <Text style={styles.speedHudSubtext}>
                            {playbackRate < 1.0
                                ? '← Slower'
                                : playbackRate > 1.0
                                    ? 'Faster →'
                                    : 'Normal'}
                        </Text>
                    </View>
                </View>
            )}

            {/* Resize Mode HUD (NEW) */}
            {showResizeHUD && (
                <View style={styles.hudCenter} pointerEvents="none">
                    <View style={styles.hudPill}>
                        <ResizeModeIcon size={20} color="#fff" />
                        <Text style={styles.hudText}>{resizeModeText}</Text>
                    </View>
                </View>
            )}

            {/* Zoom HUD */}
            {zoomActive && zoomHUDScale > 1 && (
                <View style={styles.zoomHudCenter} pointerEvents="none">
                    <View style={styles.hudPill}>
                        <Feather name="maximize" size={18} color="#fff" />
                        <Text style={styles.hudText}>{zoomHUDScale.toFixed(2)}x</Text>
                        <Text style={styles.hudSubtext}>Pan to view</Text>
                    </View>
                </View>
            )}
        </>
    );
});

VideoHUD.displayName = 'VideoHUD';

const styles = StyleSheet.create({
    bufferOverlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        zIndex: 5,
    },
    bufferText: {
        color: '#fff',
        marginTop: 12,
        fontSize: 14,
        fontWeight: '500',
    },
    hudCenter: {
        position: 'absolute',
        top: '50%',
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 8,
        transform: [{ translateY: -20 }], // Half of typical HUD height (40px)
    },
    seekHUDSide: {
        position: 'absolute',
        top: '50%',
        zIndex: 8,
        transform: [{ translateY: -20 }], // Half of typical HUD height
    },
    zoomHudCenter: {
        position: 'absolute',
        bottom: '20%',
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 8,
    },
    hudSide: {
        position: 'absolute',
        top: '50%',
        zIndex: 8,
        alignItems: 'center',
        gap: 8,
        width: 60, // Fixed width to prevent layout shift
        marginTop: -94, // Half of total height (Text 20 + Gap 8 + Track 120 + Gap 8 + Icon 32 = 188 / 2 = 94)
    },
    hudPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(0,0,0,0.6)',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 24,
    },
    seekHUDPill: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: 'rgba(0,0,0,0.45)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
    },
    hudText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
        padding: 0,
    },
    timeDiffText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        padding: 0,
        includeFontPadding: false,
    },
    targetTimeText: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 11,
        fontWeight: '500',
        padding: 0,
        includeFontPadding: false,
    },
    reanimatedText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
        padding: 0,
        includeFontPadding: false,
    },
    hudSubtext: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 12,
        fontWeight: '400',
        marginLeft: 4,
    },
    // Vertical HUD Styles
    verticalTrack: {
        width: 6,
        height: 120,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 3,
        overflow: 'hidden',
        justifyContent: 'flex-end',
    },
    verticalFill: {
        width: '100%',
        backgroundColor: '#fff',
        borderRadius: 3,
    },
    verticalIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    verticalHudText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: 'bold',
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 2,
        marginBottom: 4,
        textAlign: 'center',
        padding: 0,
        includeFontPadding: false,
    },
    // Speed HUD Specific Styles
    speedHudTop: {
        position: 'absolute',
        top: '15%',
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 8,
    },
    speedHudPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(0,0,0,0.6)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    speedHudText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
        padding: 0,
        includeFontPadding: false,
    },
    speedHudSubtext: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 11,
        fontWeight: '500',
        marginLeft: 2,
    },
});
