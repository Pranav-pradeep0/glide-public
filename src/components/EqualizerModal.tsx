/**
 * EqualizerModal Component
 * 
 * A comprehensive 10-band equalizer modal.
 * Features:
 * - Preset selector
 * - 10 interactive vertical sliders
 * - Band frequency labels and descriptions
 * - Reset functionality
 */

import React, { useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    ScrollView,
    useWindowDimensions,
    Switch,
    Modal,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Feather from '@react-native-vector-icons/feather';
import { VerticalSlider } from './VerticalSlider';
import { EQUALIZER_PRESETS, EQUALIZER_BANDS } from '@/config/equalizerPresets';

interface EqualizerModalProps {
    visible: boolean;
    onClose: () => void;
    activePresetId: string;
    customBands: number[];
    onSelectPreset: (presetId: string) => void;
    onSetBandValue: (index: number, value: number) => void;
    onReset: () => void;
    enabled: boolean;
    onToggleEnabled: (enabled: boolean) => void;
}

export const EqualizerModal: React.FC<EqualizerModalProps> = ({
    visible,
    onClose,
    activePresetId,
    customBands,
    onSelectPreset,
    onSetBandValue,
    onReset,
    enabled,
    onToggleEnabled,
}) => {
    const { width, height } = useWindowDimensions();
    const isLandscape = width > height;

    const activePreset = EQUALIZER_PRESETS.find(p => p.id === activePresetId);

    // Display current bands based on preset or custom
    const displayedBands = activePresetId === 'custom'
        ? customBands
        : (activePreset ? activePreset.values : customBands);

    // Active color for enabled state
    const ACTIVE_COLOR = '#FFFFFF';

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent={true}
        >
            <View style={styles.overlay}>
                {/* Independent backdrop pressable */}
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                />

                <GestureHandlerRootView style={styles.rootView}>
                    <View
                        style={styles.modalContainer}
                    >
                        {/* Header */}
                        <View style={styles.header}>
                            <View style={styles.headerLeft}>
                                <View style={styles.headerTitleRow}>
                                    <Text style={styles.title}>Audio Equalizer</Text>
                                </View>
                                <Text style={[styles.subtitle, { color: enabled ? '#CCCCCC' : '#666' }]}>
                                    {enabled ? (activePreset ? activePreset.name : 'Custom Tuning') : 'Off'}
                                </Text>
                            </View>

                            <View style={styles.headerRight}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.resetButton,
                                            pressed && styles.pressed,
                                            !enabled && styles.disabled
                                        ]}
                                        onPress={enabled ? onReset : undefined}
                                        disabled={!enabled}
                                    >
                                        <Feather name="refresh-cw" size={16} color={enabled ? "#CCCCCC" : "#666"} />
                                    </Pressable>
                                    <Switch
                                        value={enabled}
                                        onValueChange={onToggleEnabled}
                                        trackColor={{ false: '#333', true: '#666' }}
                                        thumbColor={enabled ? '#FFF' : '#999'}
                                    />
                                </View>

                                <Pressable
                                    style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                                    onPress={onClose}
                                >
                                    <Feather name="x" size={22} color="#808080" />
                                </Pressable>
                            </View>
                        </View>

                        {/* Content */}
                        <View style={styles.contentWrapper}>
                            <ScrollView
                                style={styles.scrollContainer}
                                contentContainerStyle={styles.scrollContent}
                                showsVerticalScrollIndicator={true}
                            >
                                {/* Presets Row */}
                                <View style={styles.presetsContainer}>
                                    <ScrollView
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        contentContainerStyle={styles.presetsContent}
                                    >
                                        {EQUALIZER_PRESETS.map((preset) => {
                                            const isActive = activePresetId === preset.id;

                                            const chipBg = isActive ? '#FFFFFF' : '#1F1F1F';
                                            const chipBorder = isActive ? '#FFFFFF' : '#333';
                                            const chipText = isActive ? '#000000' : '#CCCCCC';
                                            const iconColor = isActive ? '#000000' : '#CCCCCC';

                                            return (
                                                <Pressable
                                                    key={preset.id}
                                                    style={({ pressed }) => [
                                                        styles.presetChip,
                                                        { backgroundColor: chipBg, borderColor: chipBorder },
                                                        pressed && styles.presetChipPressed
                                                    ]}
                                                    onPress={() => onSelectPreset(preset.id)}
                                                    disabled={!enabled}
                                                >
                                                    {preset.icon && (
                                                        <Feather
                                                            name={preset.icon as any}
                                                            size={14}
                                                            color={iconColor}
                                                            style={styles.presetIcon}
                                                        />
                                                    )}
                                                    <Text style={[styles.presetText, { color: chipText }]}>
                                                        {preset.name}
                                                    </Text>
                                                </Pressable>
                                            );
                                        })}
                                    </ScrollView>
                                </View>

                                {/* Sliders Area */}
                                <View style={[styles.slidersWrapper, !enabled && styles.disabledContent]}>
                                    <ScrollView
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        contentContainerStyle={styles.slidersContent}
                                        nestedScrollEnabled={true}
                                    >
                                        {EQUALIZER_BANDS.map((band, index) => (
                                            <BandSlider
                                                key={band.freq}
                                                band={band}
                                                index={index}
                                                value={displayedBands[index] || 0}
                                                onChange={onSetBandValue}
                                                isLandscape={isLandscape}
                                                activeColor={ACTIVE_COLOR}
                                                enabled={enabled}
                                            />
                                        ))}
                                    </ScrollView>
                                </View>
                            </ScrollView>
                        </View>
                    </View>
                </GestureHandlerRootView>
            </View>
        </Modal>
    );
};

// Memoized BandSlider component
const BandSlider = React.memo<{
    band: any;
    index: number;
    value: number;
    onChange: (index: number, val: number) => void;
    isLandscape: boolean;
    activeColor: string;
    enabled: boolean;
}>(({ band, index, value, onChange, isLandscape, activeColor, enabled }) => {
    const handleChange = useCallback((val: number) => {
        onChange(index, val);
    }, [index, onChange]);

    return (
        <View style={[styles.bandColumn, !enabled && styles.bandColumnDisabled]}>
            <View style={[styles.sliderWrapper, { height: isLandscape ? 160 : 220 }]}>
                <VerticalSlider
                    min={-12}
                    max={12}
                    step={1}
                    value={value}
                    onValueChange={handleChange}
                    height={isLandscape ? 140 : 200}
                    activeTrackColor={activeColor}
                    trackColor="#333"
                    disabled={!enabled}
                />
            </View>

            <View style={styles.bandInfo}>
                <Text style={styles.freqLabel}>{band.label}</Text>
                <Text style={styles.dbLabel}>
                    {value > 0 ? '+' : ''}
                    {value}dB
                </Text>
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.85)',
    },
    rootView: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContainer: {
        width: '90%',
        height: '90%',
        backgroundColor: '#0A0A0A',
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.5,
        shadowRadius: 24,
        elevation: 12,
        flexDirection: 'column',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#1A1A1A',
        backgroundColor: '#0A0A0A',
    },
    headerLeft: {
        flex: 1,
        marginRight: 16,
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    title: {
        color: '#CCCCCC',
        fontSize: 18,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    subtitle: {
        fontSize: 13,
        fontWeight: '600',
    },
    closeButton: {
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: '#0F0F0F',
        alignItems: 'center',
        justifyContent: 'center',
    },
    resetButton: {
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: '#1F1F1F',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#333',
    },
    pressed: {
        opacity: 0.7,
        transform: [{ scale: 0.95 }],
    },
    disabled: {
        opacity: 0.5,
    },
    contentWrapper: {
        flex: 1,
        backgroundColor: '#121212',
    },
    scrollContainer: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 30,
        flexGrow: 1,
    },
    presetsContainer: {
        marginTop: 20,
        marginBottom: 8,
        minHeight: 50,
    },
    presetsContent: {
        paddingHorizontal: 16,
        gap: 8,
    },
    presetChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
    },
    presetChipPressed: {
        opacity: 0.8,
        transform: [{ scale: 0.97 }],
    },
    presetIcon: {
        marginRight: 6,
    },
    presetText: {
        fontSize: 13,
        fontWeight: '600',
    },
    slidersWrapper: {
        paddingHorizontal: 4,
    },
    disabledContent: {
        opacity: 0.5,
    },
    slidersContent: {
        paddingHorizontal: 16,
        paddingTop: 20,
        paddingBottom: 10,
        gap: 12,
        minHeight: 280,
    },
    bandColumn: {
        width: 60,
        alignItems: 'center',
    },
    bandColumnDisabled: {
        // opacity handled by parent wrapper but kept for safety
    },
    sliderWrapper: {
        justifyContent: 'center',
        marginBottom: 10,
        width: 60,
        alignItems: 'center',
    },
    bandInfo: {
        alignItems: 'center',
        gap: 2,
    },
    freqLabel: {
        color: '#E0E0E0',
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 2,
    },
    dbLabel: {
        color: '#AAAAAA',
        fontSize: 11,
        fontVariant: ['tabular-nums'],
    },
});