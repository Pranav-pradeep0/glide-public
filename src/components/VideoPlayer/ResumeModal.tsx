import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { RecapIcon } from './PlayerIcons';

interface ResumeModalProps {
    visible: boolean;
    videoName: string;
    resumeTime: number;
    formattedResumeTime: string;
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
    showRecapOption,
    isGeneratingRecap = false,
    onResume,
    onRestart,
    onRecap,
    onClose
}) => {
    const { width, height } = useWindowDimensions();
    const isLandscape = width > height;

    if (!visible) return null;

    // Portrait layout: stacked vertically
    if (!isLandscape) {
        return (
            <Modal
                transparent
                visible={visible}
                animationType="fade"
                onRequestClose={onClose}
                statusBarTranslucent
                navigationBarTranslucent
            >
                <Pressable style={styles.overlay} onPress={onResume}>
                    <Animated.View
                        entering={FadeInDown.duration(300).springify().damping(20).mass(0.8)}
                        style={styles.stripPortrait}
                    >
                        {/* Close button - top right */}
                        <Pressable
                            style={({ pressed }) => [
                                styles.closeBtnPortrait,
                                pressed && styles.buttonPressed
                            ]}
                            onPress={onClose}
                            hitSlop={10}
                        >
                            <Feather name="x" size={18} color="rgba(255,255,255,0.5)" />
                        </Pressable>

                        {/* Time Badge */}
                        <View style={styles.timeBadgePortrait}>
                            <Feather name="clock" size={16} color="#FFF" />
                            <Text style={styles.timeTextPortrait}>{formattedResumeTime}</Text>
                        </View>

                        {/* Divider */}
                        <View style={styles.horizontalDivider} />

                        {/* Secondary Actions Row (Restart & Recap) */}
                        <View style={styles.actionsGroupPortrait}>
                            <Pressable
                                style={({ pressed }) => [
                                    styles.secondaryPillPortrait,
                                    pressed && styles.buttonPressed
                                ]}
                                onPress={onRestart}
                            >
                                <Feather name="rotate-ccw" size={14} color="#FFF" />
                                <Text style={styles.secondaryPillText}>Restart</Text>
                            </Pressable>

                            {showRecapOption && (
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.secondaryPillPortrait,
                                        pressed && styles.buttonPressed,
                                        isGeneratingRecap && { opacity: 0.5 }
                                    ]}
                                    onPress={onRecap}
                                    disabled={isGeneratingRecap}
                                >
                                    {isGeneratingRecap ? (
                                        <ActivityIndicator size="small" color="#FFF" />
                                    ) : (
                                        <RecapIcon size={14} color="#FFF" active={true} />
                                    )}
                                    <Text style={styles.secondaryPillText}>Recap</Text>
                                </Pressable>
                            )}
                        </View>

                        {/* Resume Button - Full Width */}
                        <Pressable
                            style={({ pressed }) => [
                                styles.resumePillPortraitFull,
                                pressed && styles.buttonPressed
                            ]}
                            onPress={onResume}
                        >
                            <Feather name="play" size={16} color="#000" />
                            <Text style={styles.resumePillTextPortrait}>Resume</Text>
                        </Pressable>
                    </Animated.View>
                </Pressable>
            </Modal>
        );
    }

    // Landscape layout: horizontal strip
    return (
        <Modal
            transparent
            visible={visible}
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent
            navigationBarTranslucent
        >
            <Pressable style={styles.overlay} onPress={onResume}>
                <Animated.View
                    entering={FadeInDown.duration(300).springify().damping(20).mass(0.8)}
                    style={styles.controlStrip}
                >
                    {/* Left: Info Group */}
                    <View style={styles.infoGroup}>
                        <View style={styles.timeBadge}>
                            <Feather name="clock" size={14} color="#FFF" />
                            <Text style={styles.timeText}>{formattedResumeTime}</Text>
                        </View>
                        <View style={styles.verticalDivider} />
                    </View>

                    {/* Right: Actions Group */}
                    <View style={styles.actionsGroup}>
                        <Pressable
                            style={({ pressed }) => [
                                styles.secondaryPill,
                                pressed && styles.buttonPressed
                            ]}
                            onPress={onRestart}
                        >
                            <Feather name="rotate-ccw" size={14} color="#FFF" />
                            <Text style={styles.secondaryPillText}>Restart</Text>
                        </Pressable>

                        <Pressable
                            style={({ pressed }) => [
                                styles.resumePill,
                                pressed && styles.buttonPressed
                            ]}
                            onPress={onResume}
                        >
                            <Feather name="play" size={14} color="#000" />
                            <Text style={styles.resumePillText}>Resume</Text>
                        </Pressable>

                        {showRecapOption && (
                            <Pressable
                                style={({ pressed }) => [
                                    styles.secondaryPill,
                                    pressed && styles.buttonPressed,
                                    isGeneratingRecap && { opacity: 0.5 }
                                ]}
                                onPress={onRecap}
                                disabled={isGeneratingRecap}
                            >
                                {isGeneratingRecap ? (
                                    <ActivityIndicator size="small" color="#FFF" />
                                ) : (
                                    <RecapIcon size={14} color="#FFF" active={true} />
                                )}
                                <Text style={styles.secondaryPillText}>Recap</Text>
                            </Pressable>
                        )}

                        <View style={styles.smallDivider} />
                    </View>

                    <Pressable
                        style={({ pressed }) => [
                            styles.closeBtn,
                            pressed && styles.buttonPressed
                        ]}
                        onPress={onClose}
                        hitSlop={10}
                    >
                        <Feather name="x" size={18} color="rgba(255,255,255,0.3)" />
                    </Pressable>
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
    },
    // Landscape styles
    controlStrip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(15, 15, 15, 0.98)',
        borderRadius: 32,
        paddingVertical: 8,
        paddingLeft: 20,
        paddingRight: 8,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.12)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    // Portrait styles
    stripPortrait: {
        backgroundColor: 'rgba(15, 15, 15, 0.98)',
        borderRadius: 20,
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.12)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
        minWidth: 280,
        maxWidth: '90%',
        alignItems: 'stretch',
    },
    closeBtnPortrait: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 32,
        height: 32,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    timeBadgePortrait: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 4,
    },
    timeTextPortrait: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
        letterSpacing: -0.5,
    },
    horizontalDivider: {
        width: '100%',
        height: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        marginVertical: 14,
    },
    actionsGroupPortrait: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        width: '100%',
    },
    secondaryPillPortrait: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.08)',
        height: 40,
        borderRadius: 20,
        gap: 6,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
    },
    resumePillPortraitFull: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'stretch',
        justifyContent: 'center',
        backgroundColor: '#FFF',
        height: 44,
        borderRadius: 22,
        gap: 8,
        marginTop: 12,
    },
    resumePillTextPortrait: {
        color: '#000',
        fontSize: 15,
        fontWeight: 'bold',
    },
    // Shared landscape styles
    infoGroup: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    timeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    timeText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
        letterSpacing: -0.5,
    },
    verticalDivider: {
        width: 1,
        height: 24,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        marginHorizontal: 16,
    },
    actionsGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    secondaryPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.08)',
        height: 40,
        paddingHorizontal: 14,
        borderRadius: 20,
        gap: 6,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
    },
    secondaryPillText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 13,
        fontWeight: '600',
    },
    resumePill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        height: 40,
        paddingHorizontal: 14,
        borderRadius: 20,
        gap: 6,
        marginLeft: 4,
    },
    resumePillText: {
        color: '#000',
        fontSize: 13,
        fontWeight: 'bold',
    },
    smallDivider: {
        width: 1,
        height: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        marginHorizontal: 4,
    },
    closeBtn: {
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonPressed: {
        opacity: 0.7,
        transform: [{ scale: 0.96 }],
    },
});
