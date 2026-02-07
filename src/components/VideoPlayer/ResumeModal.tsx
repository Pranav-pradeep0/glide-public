import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import Animated, {
    FadeIn,
    FadeOut,
} from 'react-native-reanimated';
import { RecapIcon } from './PlayerIcons';

const formatVerboseTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return '';

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0) parts.push(`${mins}m`);
    // Only show seconds if less than a minute, or if we want full precision
    // For "remaining time", usually H:M is enough if > 0, but user asked for "mn sc hr"
    // Let's do:
    // > 1h: 1h 20m
    // < 1h: 20m 30s
    // < 1m: 30s

    if (hrs > 0) {
        // If hours exist, we can probably skip seconds for cleaner look, 
        // OR keep them if user explicitly said "mn sc hr". 
        // "sholdnt we show mn sc hr or something wit the tim e?" -> implies all parts.
        // Let's show all parts if they exist.
        if (secs > 0) parts.push(`${secs}s`);
    } else {
        if (mins > 0) {
            if (secs > 0) parts.push(`${secs}s`);
        } else {
            parts.push(`${secs}s`);
        }
    }

    return parts.join(' ');
};

interface ResumeModalProps {
    visible: boolean;
    videoName: string;
    resumeTime: number;
    formattedResumeTime: string;
    remainingTime?: number;
    finishByTime?: string;
    showRecapOption: boolean;
    isGeneratingRecap?: boolean;
    onResume: () => void;
    onRestart: () => void;
    onRecap: () => void;
    onClose: () => void;
}

export const ResumeModal: React.FC<ResumeModalProps> = ({
    visible,
    videoName,
    resumeTime,
    formattedResumeTime,
    remainingTime,
    finishByTime,
    showRecapOption,
    isGeneratingRecap = false,
    onResume,
    onRestart,
    onRecap,
    onClose,
}) => {
    const { width } = useWindowDimensions();

    if (!visible) return null;

    const formattedRemaining = remainingTime !== undefined ? formatVerboseTime(remainingTime) : null;

    return (
        <Modal
            transparent
            visible={visible}
            animationType="none"
            onRequestClose={onClose}
            statusBarTranslucent
            navigationBarTranslucent
        >
            <Pressable style={styles.overlay} onPress={onResume}>
                <Animated.View
                    entering={FadeIn.duration(300)}
                    exiting={FadeOut.duration(200)}
                    style={[
                        styles.container,
                        { maxWidth: 420 }
                    ]}
                >
                    {/* Header with close button */}
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            <Text style={styles.headerText}>Continue Watching</Text>
                        </View>
                        <Pressable
                            style={({ pressed }) => [
                                styles.closeBtn,
                                pressed && styles.buttonPressed
                            ]}
                            onPress={onClose}
                            hitSlop={10}
                        >
                            <Feather name="x" size={20} color="rgba(255,255,255,0.6)" />
                        </Pressable>
                    </View>

                    {/* Time Badge */}
                    <View style={styles.timeSection}>
                        <Feather name="clock" size={24} color="rgba(255,255,255,0.7)" />

                        <View style={styles.textContainer}>
                            {/* Primary: Last Watched */}
                            <View style={styles.timeRowPrimary}>
                                <Text style={styles.timeText}>Last watched at</Text>
                                <Text style={styles.timeValue}>{formattedResumeTime}</Text>
                            </View>

                            {/* Secondary: Remaining & Finish By */}
                            {(formattedRemaining || finishByTime) && (
                                <View style={styles.timeRowSecondary}>
                                    {formattedRemaining && (
                                        <Text style={styles.timeSecondaryText}>{formattedRemaining} remaining</Text>
                                    )}
                                    {formattedRemaining && finishByTime && (
                                        <View style={styles.timeDot} />
                                    )}
                                    {finishByTime && (
                                        <Text style={styles.timeSecondaryText}>Finish by {finishByTime}</Text>
                                    )}
                                </View>
                            )}
                        </View>
                    </View>

                    {/* Divider */}
                    <View style={styles.divider} />

                    {/* Actions - Fully responsive with flex wrap */}
                    <View style={styles.actions}>
                        <Pressable
                            style={({ pressed }) => [
                                styles.actionButton,
                                styles.secondaryButton,
                                pressed && styles.buttonPressed
                            ]}
                            onPress={onRestart}
                        >
                            <Feather name="rotate-ccw" size={18} color="rgba(255,255,255,0.9)" />
                            <Text style={styles.secondaryButtonText}>Start Over</Text>
                        </Pressable>

                        {showRecapOption && (
                            <Pressable
                                style={({ pressed }) => [
                                    styles.actionButton,
                                    styles.secondaryButton,
                                    pressed && styles.buttonPressed,
                                    isGeneratingRecap && { opacity: 0.5 }
                                ]}
                                onPress={onRecap}
                                disabled={isGeneratingRecap}
                            >
                                {isGeneratingRecap ? (
                                    <ActivityIndicator size="small" color="rgba(255,255,255,0.9)" />
                                ) : (
                                    <RecapIcon size={18} color="rgba(255,255,255,0.9)" active={true} />
                                )}
                                <Text style={styles.secondaryButtonText}>Recap</Text>
                            </Pressable>
                        )}

                        <Pressable
                            style={({ pressed }) => [
                                styles.actionButton,
                                styles.primaryButton,
                                pressed && styles.buttonPressed
                            ]}
                            onPress={onResume}
                        >
                            <Feather name="play" size={18} color="#000" />
                            <Text style={styles.primaryButtonText}>Resume Playing</Text>
                        </Pressable>
                    </View>
                </Animated.View>
            </Pressable>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
    },
    container: {
        backgroundColor: 'rgba(18, 18, 18, 0.98)',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.5,
        shadowRadius: 16,
        elevation: 10,
        padding: 20,
        paddingTop: 16,
        minWidth: 280,
        margin: 16,
    },

    // Header
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headerText: {
        color: 'rgba(255, 255, 255, 0.5)',
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    closeBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Time Section
    timeSection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        gap: 12,
    },
    textContainer: {
        gap: 2,
    },
    timeRowPrimary: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    timeRowSecondary: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    timeText: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: 15,
        fontWeight: '500',
    },
    timeValue: {
        color: '#FFF',
        fontSize: 17,
        fontWeight: 'bold',
        letterSpacing: -0.3,
    },
    timeSecondaryText: {
        color: 'rgba(255, 255, 255, 0.5)',
        fontSize: 13,
        fontWeight: '500',
    },
    timeDot: {
        width: 3,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        marginHorizontal: 6,
    },

    // Divider
    divider: {
        height: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        marginVertical: 12,
    },

    // Actions - Pure flex wrap, no conditionals
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },

    // Action Buttons
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 40,
        paddingHorizontal: 16,
        borderRadius: 20,
        minWidth: 110,
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 'auto',
    },

    secondaryButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    secondaryButtonText: {
        color: 'rgba(255, 255, 255, 0.9)',
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: -0.2,
    },

    primaryButton: {
        backgroundColor: '#FFF',
        minWidth: 160,
        flexBasis: '100%', // Forces to new line on narrow screens for emphasis
    },
    primaryButtonText: {
        color: '#000',
        fontSize: 15,
        fontWeight: 'bold',
        letterSpacing: -0.2,
    },

    buttonPressed: {
        opacity: 0.7,
        transform: [{ scale: 0.98 }],
    },
});