import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { BlurView } from '@react-native-community/blur';
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

    return (
        <Modal
            transparent
            visible={visible}
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent
            navigationBarTranslucent
        >
            <View style={styles.overlay} pointerEvents="box-none">
                <Animated.View
                    entering={FadeInDown.springify().damping(15)}
                    style={[
                        styles.controlStrip,
                        isLandscape ? styles.stripLandscape : styles.stripPortrait
                    ]}
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
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
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
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 15,
        elevation: 10,
    },
    stripPortrait: {
        width: 'auto',
        maxWidth: '92%',
    },
    stripLandscape: {
        width: 'auto',
    },
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
    }
});
