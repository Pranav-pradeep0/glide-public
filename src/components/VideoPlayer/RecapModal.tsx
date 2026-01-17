import React, { useEffect, useState } from 'react';
import {
    StyleSheet,
    View,
    Text,
    Modal,
    TouchableOpacity,
    ScrollView,
    Dimensions,
} from 'react-native';
import { BlurView } from '@react-native-community/blur';
import Feather from '@react-native-vector-icons/feather';
import Animated, {
    FadeIn,
    FadeInDown,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
    Easing,
    interpolate,
} from 'react-native-reanimated';
import { RecapIcon } from './PlayerIcons';

interface RecapModalProps {
    visible: boolean;
    onClose: () => void;
    recapText: string | null; // null means loading
    videoName: string;
    isLoading?: boolean;
    loadingMessage?: string;
}

// Get dimensions synchronously for initial render
const getInitialDimensions = () => {
    const { width, height } = Dimensions.get('window');
    return { width, height, isLandscape: width > height };
};

// Skeleton line component with pulsating animation
const SkeletonLine: React.FC<{ widthPercent: number; delay?: number }> = ({ widthPercent, delay = 0 }) => {
    const pulse = useSharedValue(0);

    useEffect(() => {
        pulse.value = withRepeat(
            withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
            -1,
            true
        );
    }, []);

    const animatedStyle = useAnimatedStyle(() => {
        const opacity = interpolate(pulse.value, [0, 1], [0.3, 0.7]);
        return { opacity };
    });

    return (
        <Animated.View
            style={[
                styles.skeletonLine,
                { width: `${widthPercent}%` as any },
                animatedStyle
            ]}
        />
    );
};

// Loading skeleton content
const LoadingSkeleton: React.FC<{ message?: string }> = ({ message }) => {
    return (
        <View style={styles.skeletonContainer}>
            {message && (
                <Animated.Text
                    entering={FadeIn}
                    style={styles.loadingMessage}
                >
                    {message}
                </Animated.Text>
            )}
            <View style={styles.skeletonContent}>
                <SkeletonLine widthPercent={100} />
                <SkeletonLine widthPercent={95} delay={100} />
                <SkeletonLine widthPercent={88} delay={200} />
                <SkeletonLine widthPercent={92} delay={300} />
                <SkeletonLine widthPercent={60} delay={400} />
            </View>
        </View>
    );
};

export const RecapModal: React.FC<RecapModalProps> = ({
    visible,
    onClose,
    recapText,
    videoName,
    isLoading = false,
    loadingMessage,
}) => {
    // Use state to track dimensions and update on change
    const [dimensions, setDimensions] = useState(getInitialDimensions);
    const [isReady, setIsReady] = useState(false);

    // Listen for dimension changes
    useEffect(() => {
        const subscription = Dimensions.addEventListener('change', ({ window }) => {
            setDimensions({
                width: window.width,
                height: window.height,
                isLandscape: window.width > window.height
            });
        });

        return () => subscription?.remove();
    }, []);

    // Reset ready state when visibility changes, and set ready after a micro-task
    // This ensures we have correct dimensions before animating
    useEffect(() => {
        if (visible) {
            // Get fresh dimensions when modal opens
            const fresh = getInitialDimensions();
            setDimensions(fresh);
            // Use requestAnimationFrame to wait for layout
            requestAnimationFrame(() => {
                setIsReady(true);
            });
        } else {
            setIsReady(false);
        }
    }, [visible]);

    const { width, height, isLandscape } = dimensions;
    const showLoading = isLoading || recapText === null;

    if (!visible) return null;

    // Calculate responsive dimensions
    const contentWidth = isLandscape ? Math.min(width * 0.7, 600) : Math.min(width * 0.85, 500);
    const contentMaxHeight = isLandscape ? height * 0.8 : height * 0.7;
    const scrollMaxHeight = isLandscape ? height * 0.4 : 300;

    return (
        <Modal
            transparent
            statusBarTranslucent
            navigationBarTranslucent
            visible={visible}
            animationType="none" // We handle animation ourselves
            onRequestClose={onClose}
        >
            <View style={styles.container}>
                <BlurView
                    style={StyleSheet.absoluteFill}
                    blurType="dark"
                    blurAmount={15}
                    reducedTransparencyFallbackColor="black"
                />

                {isReady && (
                    <Animated.View
                        entering={FadeInDown.springify().damping(20)}
                        style={[
                            styles.content,
                            {
                                width: contentWidth,
                                maxHeight: contentMaxHeight
                            }
                        ]}
                    >
                        <View style={styles.header}>
                            <View style={styles.titleRow}>
                                <View style={styles.iconContainer}>
                                    <RecapIcon size={20} color="#FFF" active={true} />
                                </View>
                                <Text style={styles.title} numberOfLines={1}>{videoName}</Text>
                            </View>
                            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                                <Feather name="x" size={24} color="#FFF" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView
                            style={[
                                styles.scrollContainer,
                                { maxHeight: scrollMaxHeight }
                            ]}
                            contentContainerStyle={styles.scrollContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {showLoading ? (
                                <LoadingSkeleton message={loadingMessage} />
                            ) : (
                                <Animated.Text
                                    entering={FadeIn.duration(300)}
                                    style={styles.recapText}
                                >
                                    {recapText}
                                </Animated.Text>
                            )}
                        </ScrollView>

                        <TouchableOpacity
                            onPress={onClose}
                            activeOpacity={0.8}
                            disabled={showLoading}
                            style={[
                                styles.resumeButton,
                                isLandscape && { marginTop: 16, height: 48 },
                                showLoading && styles.resumeButtonDisabled
                            ]}
                        >
                            <Text style={[
                                styles.resumeButtonText,
                                showLoading && styles.resumeButtonTextDisabled
                            ]}>
                                {showLoading ? 'Generating Recap...' : 'Resume Playback'}
                            </Text>
                            {!showLoading && <Feather name="play" size={16} color="#000" />}
                        </TouchableOpacity>
                    </Animated.View>
                )}
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.67)',
    },
    content: {
        borderRadius: 24,
        padding: 24,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '700',
        flex: 1,
    },
    closeButton: {
        padding: 4,
    },
    scrollContainer: {
        maxHeight: 300,
    },
    scrollContent: {
        paddingBottom: 10,
    },
    recapText: {
        color: 'rgba(255, 255, 255, 0.9)',
        fontSize: 16,
        lineHeight: 24,
        fontStyle: 'italic',
        letterSpacing: 0.3,
    },
    resumeButton: {
        marginTop: 24,
        backgroundColor: '#FFF',
        height: 54,
        borderRadius: 27,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 10,
    },
    resumeButtonDisabled: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
    },
    resumeButtonText: {
        color: '#000',
        fontSize: 16,
        fontWeight: '700',
    },
    resumeButtonTextDisabled: {
        color: 'rgba(255, 255, 255, 0.7)',
    },
    // Skeleton styles
    skeletonContainer: {
        paddingVertical: 8,
    },
    loadingMessage: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: 14,
        marginBottom: 16,
        textAlign: 'center',
        fontStyle: 'italic',
    },
    skeletonContent: {
        gap: 12,
    },
    skeletonLine: {
        height: 16,
        borderRadius: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
    },
});
