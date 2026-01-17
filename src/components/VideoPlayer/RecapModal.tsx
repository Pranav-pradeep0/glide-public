import React from 'react';
import {
    StyleSheet,
    View,
    Text,
    Modal,
    TouchableOpacity,
    ScrollView,
    useWindowDimensions,
} from 'react-native';
import { BlurView } from '@react-native-community/blur';
import Feather from '@react-native-vector-icons/feather';
import Animated, { FadeIn, FadeInDown, Layout } from 'react-native-reanimated';
import { RecapIcon } from './PlayerIcons';

interface RecapModalProps {
    visible: boolean;
    onClose: () => void;
    recapText: string;
    videoName: string;
}

export const RecapModal: React.FC<RecapModalProps> = ({
    visible,
    onClose,
    recapText,
    videoName,
}) => {
    const { width, height } = useWindowDimensions();
    const isLandscape = width > height;

    if (!visible) return null;

    return (
        <Modal
            transparent
            statusBarTranslucent
            navigationBarTranslucent
            visible={visible}
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.container}>
                <BlurView
                    style={StyleSheet.absoluteFill}
                    blurType="dark"
                    blurAmount={15}
                    reducedTransparencyFallbackColor="black"
                />

                <Animated.View
                    entering={FadeInDown.springify()}
                    style={[
                        styles.content,
                        {
                            width: isLandscape ? Math.min(width * 0.7, 600) : Math.min(width * 0.85, 500),
                            maxHeight: isLandscape ? height * 0.8 : height * 0.7
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
                            { maxHeight: isLandscape ? height * 0.4 : 300 }
                        ]}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        <Text style={styles.recapText}>{recapText}</Text>
                    </ScrollView>

                    <TouchableOpacity
                        onPress={onClose}
                        activeOpacity={0.8}
                        style={[
                            styles.resumeButton,
                            isLandscape && { marginTop: 16, height: 48 }
                        ]}
                    >
                        <Text style={styles.resumeButtonText}>Resume Playback</Text>
                        <Feather name="play" size={16} color="#000" />
                    </TouchableOpacity>
                </Animated.View>
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
    resumeButtonText: {
        color: '#000',
        fontSize: 16,
        fontWeight: '700',
    },
});
