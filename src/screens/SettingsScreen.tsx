import React, { useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Switch,
    TouchableOpacity,
    ScrollView,
    Alert,
    Modal,
    FlatList,
    TextInput,
    Linking,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useAppStore } from '../store/appStore';
import { useVideoHistoryStore } from '../store/videoHistoryStore';
import { useTheme } from '../hooks/useTheme';
import { SUBTITLE_FONT_SIZES, SUBTITLE_COLORS } from '../utils/constants';
import { FileService } from '@/services/FileService';
import { LANGUAGES } from '@/utils/languages';
import HapticModule from '../native/HapticModule';
import { Feather } from '@react-native-vector-icons/feather';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';

// Reanimated Text for smooth preview
const AnimatedText = Animated.createAnimatedComponent(Text);

// Isolated Slider Component to prevent parent re-renders
const FontSizeSliderControl = React.memo(({ fontSizeSV, onFinalChange, theme }: any) => {
    const [displaySize, setDisplaySize] = React.useState(fontSizeSV.value);

    return (
        <View style={[styles.sliderCard, { backgroundColor: theme.colors.card }]}>
            <View style={styles.sliderHeader}>
                <Text style={[styles.itemLabel, { color: theme.colors.text }]}>Size</Text>
                <Text style={{ color: theme.colors.textSecondary }}>{Math.round(displaySize)}px</Text>
            </View>
            <Slider
                style={styles.slider}
                minimumValue={12}
                maximumValue={40}
                value={displaySize}
                onValueChange={(val) => {
                    fontSizeSV.value = val;
                    setDisplaySize(val);
                }}
                onSlidingComplete={(val) => {
                    runOnJS(onFinalChange)(Math.round(val));
                }}
                minimumTrackTintColor={theme.colors.primary}
                maximumTrackTintColor={theme.colors.border}
                thumbTintColor={theme.colors.primary}
            />
        </View>
    );
});

// Isolated Preview Component using SharedValue
const SubtitlePreviewSection = React.memo(({ fontSizeSV, settings, theme }: any) => {
    const animatedStyle = useAnimatedStyle(() => ({
        fontSize: fontSizeSV.value,
    }));

    return (
        <View style={[styles.previewContainer, { backgroundColor: '#333' }]}>
            <Text style={[styles.previewText, { color: '#AAA', marginBottom: 8 }]}>Preview</Text>
            <View style={styles.previewVideoFrame}>
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#444' }} />
                <View style={{
                    padding: 4,
                    borderRadius: 4,
                    backgroundColor: settings.subtitleBackgroundColor === 'transparent'
                        ? 'transparent'
                        : `rgba(${parseInt(settings.subtitleBackgroundColor.slice(1, 3), 16)}, ${parseInt(settings.subtitleBackgroundColor.slice(3, 5), 16)}, ${parseInt(settings.subtitleBackgroundColor.slice(5, 7), 16)}, ${settings.subtitleBackgroundOpacity})`,
                }}>
                    {(() => {
                        let fontFamily = settings.subtitleFontFamily || 'System';
                        let fontWeight = String(settings.subtitleFontWeight) as any;

                        if (fontFamily === 'NetflixSans-Medium') {
                            const weightNum = Number(settings.subtitleFontWeight);
                            if (weightNum >= 700) {
                                fontFamily = 'NetflixSans-Bold';
                                fontWeight = 'normal';
                            } else if (weightNum <= 300) {
                                fontFamily = 'NetflixSans-Light';
                                fontWeight = 'normal';
                            } else {
                                fontFamily = 'NetflixSans-Medium';
                                fontWeight = 'normal';
                            }
                        }

                        return (
                            <AnimatedText style={[{
                                color: settings.subtitleColor,
                                fontWeight: fontWeight,
                                fontFamily: fontFamily,
                                textShadowColor: settings.subtitleEdgeStyle !== 'none' ? '#000' : undefined,
                                textShadowRadius: settings.subtitleEdgeStyle !== 'none' ? settings.subtitleOutlineWidth : 0,
                                textAlign: 'center',
                            }, animatedStyle]}>
                                This is a subtitle preview
                            </AnimatedText>
                        );
                    })()}
                </View>
            </View>
        </View>
    );
});

// Intensity presets with recommendations
const INTENSITY_PRESETS = [
    { label: 'Light', value: 50, icon: 'moon', description: 'Quiet / Night' },
    { label: 'Medium', value: 100, icon: 'home', description: 'Indoor use' },
    { label: 'Strong', value: 180, icon: 'sun', description: 'Outdoor / Noisy' },
];

export default function SettingsScreen() {
    const theme = useTheme();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();

    const renderHeader = () => (
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
            <TouchableOpacity
                style={[styles.backButton, { backgroundColor: theme.colors.surface }]}
                onPress={() => navigation.goBack()}
                activeOpacity={0.7}
            >
                <Feather name="arrow-left" size={20} color={theme.colors.text} />
            </TouchableOpacity>
            <View style={styles.headerInfo}>
                <Text style={[styles.title, { color: theme.colors.text }]}>
                    Settings
                </Text>
            </View>
        </View>
    );

    const {
        settings,
        updateStatus,
        toggleDarkMode,
        toggleHaptics,
        toggleAutoDownloadSubtitles,
        setSubtitleFontSize,
        setSubtitleColor,
        setHapticIntensity,
        resetHapticSettings,
        setBrightnessMode,
        setPipBrightnessMode,
        setSubtitleFontWeight,
        setSubtitleOutlineWidth,
        setSubtitleBackgroundColor,
        setSubtitleBackgroundOpacity,
        setSubtitleEdgeStyle,
        // setSubtitleOpacity, // Not in store yet?
        // setSubtitleBottomMargin, // Not in store yet?

        resetSubtitleSettings,
        setShowSeekButtons,
        setSeekDuration,
        setAutoPlayNext,
        setDefaultAudioLanguage,
    } = useAppStore();
    const clearAllHistory = useVideoHistoryStore((state) => state.clearAllHistory);
    const [languageModalVisible, setLanguageModalVisible] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');

    // SharedValue for smooth font size animation
    const fontSizeSV = useSharedValue(settings.subtitleFontSize);

    // Sync SharedValue when settings change externally
    React.useEffect(() => {
        fontSizeSV.value = settings.subtitleFontSize;
    }, [settings.subtitleFontSize]);



    // Filter languages based on search
    const filteredLanguages = React.useMemo(() => {
        const query = searchQuery.toLowerCase();
        // Always include "Auto" option first
        const autoOption = {
            code: 'auto',
            name: 'Auto',
            nativeName: 'Automatic',
            aliases: [],
        };

        if (!query) {
            return [autoOption, ...LANGUAGES];
        }

        const matches = LANGUAGES.filter(l =>
            l.name.toLowerCase().includes(query) ||
            l.nativeName.toLowerCase().includes(query) ||
            l.code.toLowerCase().includes(query)
        );

        return [autoOption, ...matches];
    }, [searchQuery]);

    const { hapticSettings } = settings;
    const lastPreviewTime = useRef(0);

    // Preview vibration as slider changes (throttled)
    const handleIntensityChange = useCallback((value: number) => {
        setHapticIntensity(value);

        // Throttle vibration preview to avoid overwhelming the haptic motor
        const now = Date.now();
        if (now - lastPreviewTime.current > 200 && HapticModule) {
            lastPreviewTime.current = now;
            HapticModule.vibrate(80, Math.round(value));
        }
    }, [setHapticIntensity]);

    const handlePresetSelect = useCallback((value: number) => {
        setHapticIntensity(value);
        if (HapticModule) {
            HapticModule.vibrate(100, value);
        }
    }, [setHapticIntensity]);

    const getIntensityLabel = (value: number): string => {
        if (value < 50) {return 'Very Light';}
        if (value < 100) {return 'Light';}
        if (value < 150) {return 'Medium';}
        if (value < 200) {return 'Strong';}
        return 'Very Strong';
    };

    async function handleClearCache() {
        Alert.alert(
            'Clear Cache',
            'This will delete all cached subtitles. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: async () => {
                        await FileService.cleanSubtitleCache();
                        Alert.alert('Success', 'Cache cleared');
                    },
                },
            ]
        );
    }

    function handleResetHaptics() {
        Alert.alert(
            'Reset Haptic Settings',
            'This will reset intensity to default. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset',
                    style: 'destructive',
                    onPress: () => {
                        resetHapticSettings();
                    },
                },
            ]
        );
    }

    function handleClearHistory() {
        Alert.alert(
            'Clear Watch History',
            'This will delete all playback progress and bookmarks. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: () => {
                        clearAllHistory();
                        Alert.alert('Success', 'Watch history cleared');
                    },
                },
            ]
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
            {renderHeader()}
            <ScrollView
                style={[styles.container, { backgroundColor: theme.colors.background }]}
                contentContainerStyle={{ paddingBottom: 40 }}
            >
                {updateStatus.available && updateStatus.latestVersion && updateStatus.releaseUrl && (
                    <View style={[styles.updateCard, { backgroundColor: theme.colors.card }]}>
                        <View style={styles.updateHeader}>
                            <View style={styles.updateIconWrap}>
                                <Feather name="download" size={16} color={theme.colors.text} />
                            </View>
                            <View style={styles.updateTextBlock}>
                                <Text style={[styles.updateTitle, { color: theme.colors.text }]}>
                                    New version available
                                </Text>
                                <Text style={[styles.updateSubtitle, { color: theme.colors.textSecondary }]}>
                                    v{updateStatus.latestVersion} is ready to install
                                </Text>
                            </View>
                        </View>
                        <TouchableOpacity
                            style={[styles.updateButton, { backgroundColor: theme.colors.primary }]}
                            activeOpacity={0.8}
                            onPress={() => {
                                Linking.openURL(updateStatus.releaseUrl as string).catch(() => { });
                            }}
                        >
                            <Text style={styles.updateButtonText}>Open Release</Text>
                        </TouchableOpacity>
                    </View>
                )}

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                        Appearance
                    </Text>
                    <View style={[styles.item, { backgroundColor: theme.colors.card }]}>
                        <View style={styles.itemContent}>
                            <Text style={[styles.itemLabel, { color: theme.colors.text }]}>
                                Dark Mode
                            </Text>
                            <Text style={[styles.itemDescription, { color: theme.colors.textSecondary }]}>
                                Switch between light and dark theme
                            </Text>
                        </View>
                        <Switch value={settings.darkMode} onValueChange={toggleDarkMode} />
                    </View>
                </View>



                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                        Playback
                    </Text>

                    {/* Auto-Play Next */}
                    <View style={[styles.item, { backgroundColor: theme.colors.card }]}>
                        <View style={styles.itemContent}>
                            <Text style={[styles.itemLabel, { color: theme.colors.text }]}>
                                Auto-Play Next
                            </Text>
                            <Text style={[styles.itemDescription, { color: theme.colors.textSecondary }]}>
                                Automatically play the next video in the folder when the current one ends.
                            </Text>
                        </View>
                        <Switch
                            value={settings.autoPlayNext}
                            onValueChange={setAutoPlayNext}
                        />
                    </View>

                    {/* Default Audio Language */}
                    <View style={[styles.item, { backgroundColor: theme.colors.card, marginTop: 1, flexDirection: 'column', alignItems: 'flex-start' }]}>
                        <View style={styles.itemContent}>
                            <Text style={[styles.itemLabel, { color: theme.colors.text }]}>
                                Preferred Audio Language
                            </Text>
                            <Text style={[styles.itemDescription, { color: theme.colors.textSecondary }]}>
                                Select preferred language for auto-selection
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={[styles.input, {
                                borderColor: theme.colors.border,
                                backgroundColor: theme.colors.background,
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }]}
                            onPress={() => setLanguageModalVisible(true)}
                        >
                            <Text style={{ color: settings.defaultAudioLanguage ? theme.colors.text : theme.colors.textSecondary }}>
                                {settings.defaultAudioLanguage || 'Auto (Default)'}
                            </Text>
                            <Feather name="chevron-down" size={20} color={theme.colors.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    {/* Brightness Mode */}
                    <View style={[styles.item, { backgroundColor: theme.colors.card, marginTop: 1 }]}>
                        <View style={styles.itemContent}>
                            <Text style={[styles.itemLabel, { color: theme.colors.text }]}>
                                Global Brightness
                            </Text>
                            <Text style={[styles.itemDescription, { color: theme.colors.textSecondary }]}>
                                Use the same brightness level for all videos. When disabled, player remembers brightness for each video.
                            </Text>
                        </View>
                        <Switch
                            value={settings.brightnessMode === 'global'}
                            onValueChange={(val) => setBrightnessMode(val ? 'global' : 'video')}
                        />
                    </View>

                    {/* PiP Brightness Behavior */}
                    <View style={[styles.item, { backgroundColor: theme.colors.card, marginTop: 1 }]}>
                        <View style={styles.itemContent}>
                            <Text style={[styles.itemLabel, { color: theme.colors.text }]}>
                                Use Device Brightness in PiP
                            </Text>
                            <Text style={[styles.itemDescription, { color: theme.colors.textSecondary }]}>
                                When enabled, the screen brightness will revert to the system setting when entering Picture-in-Picture mode.
                            </Text>
                        </View>
                        <Switch
                            value={settings.pipBrightnessMode === 'system'}
                            onValueChange={(val) => setPipBrightnessMode(val ? 'system' : 'player')}
                        />
                    </View>

                    {/* Show Seek Buttons */}
                    <View style={[styles.item, { backgroundColor: theme.colors.card, marginTop: 1 }]}>
                        <View style={styles.itemContent}>
                            <Text style={[styles.itemLabel, { color: theme.colors.text }]}>
                                Show Seek Buttons
                            </Text>
                            <Text style={[styles.itemDescription, { color: theme.colors.textSecondary }]}>
                                Show ±{settings.seekDuration}s buttons in player controls
                            </Text>
                        </View>
                        <Switch
                            value={settings.showSeekButtons}
                            onValueChange={setShowSeekButtons}
                        />
                    </View>

                    {/* Seek Duration Slider */}
                    {settings.showSeekButtons && (
                        <View style={[styles.sliderCard, { backgroundColor: theme.colors.card, marginTop: 1 }]}>
                            <View style={styles.sliderHeader}>
                                <Text style={[styles.itemLabel, { color: theme.colors.text }]}>
                                    Seek Duration
                                </Text>
                                <Text style={[styles.intensityValue, { color: theme.colors.primary }]}>
                                    {settings.seekDuration}s
                                </Text>
                            </View>
                            <Slider
                                style={styles.slider}
                                minimumValue={5}
                                maximumValue={60}
                                step={5}
                                value={settings.seekDuration}
                                onValueChange={setSeekDuration}
                                minimumTrackTintColor={theme.colors.primary}
                                maximumTrackTintColor={theme.colors.border}
                                thumbTintColor={theme.colors.primary}
                            />
                            <View style={styles.sliderLabels}>
                                <Text style={[styles.sliderLabel, { color: theme.colors.textSecondary }]}>
                                    5s
                                </Text>
                                <Text style={[styles.sliderLabel, { color: theme.colors.textSecondary }]}>
                                    60s
                                </Text>
                            </View>
                        </View>
                    )}
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                        Haptic Feedback
                    </Text>

                    {/* Enable/Disable Toggle */}
                    <View style={[styles.item, { backgroundColor: theme.colors.card }]}>
                        <View style={styles.itemContent}>
                            <Text style={[styles.itemLabel, { color: theme.colors.text }]}>
                                Enable Haptics
                            </Text>
                            <Text style={[styles.itemDescription, { color: theme.colors.textSecondary }]}>
                                Vibrate phone when effects trigger
                            </Text>
                        </View>
                        <Switch value={hapticSettings.enabled} onValueChange={toggleHaptics} />
                    </View>

                    {/* Quick Presets */}
                    <View style={[styles.presetsCard, { backgroundColor: theme.colors.card }]}>
                        <Text style={[styles.presetsTitle, { color: theme.colors.text }]}>
                            Quick Presets
                        </Text>
                        <View style={styles.presetsRow}>
                            {INTENSITY_PRESETS.map((preset) => (
                                <TouchableOpacity
                                    key={preset.value}
                                    style={[
                                        styles.presetButton,
                                        {
                                            backgroundColor: Math.abs(hapticSettings.intensity - preset.value) < 20
                                                ? theme.colors.cardElevated
                                                : theme.colors.card,
                                            borderColor: theme.colors.border,
                                            elevation: 4,
                                        },
                                    ]}
                                    onPress={() => handlePresetSelect(preset.value)}
                                    activeOpacity={0.7}
                                    disabled={!hapticSettings.enabled}
                                >
                                    <Feather
                                        name={preset.icon as any}
                                        size={18}
                                        color={theme.colors.text}
                                    />
                                    <Text style={[
                                        styles.presetLabel,
                                        { color: theme.colors.text },
                                    ]}>
                                        {preset.label}
                                    </Text>
                                    <Text style={[
                                        styles.presetDescription,
                                        { color: theme.colors.textSecondary },
                                    ]}>
                                        {preset.description}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    {/* Intensity Slider */}
                    <View style={[styles.sliderCard, { backgroundColor: theme.colors.card }]}>
                        <View style={styles.sliderHeader}>
                            <Text style={[styles.itemLabel, { color: theme.colors.text }]}>
                                Fine-tune Intensity
                            </Text>
                            <Text style={[styles.intensityValue, { color: theme.colors.primary }]}>
                                {Math.round(hapticSettings.intensity)} ({getIntensityLabel(hapticSettings.intensity)})
                            </Text>
                        </View>
                        <Slider
                            style={styles.slider}
                            minimumValue={1}
                            maximumValue={255}
                            step={1}
                            value={hapticSettings.intensity}
                            onValueChange={handleIntensityChange}
                            minimumTrackTintColor={theme.colors.primary}
                            maximumTrackTintColor={theme.colors.border}
                            thumbTintColor={theme.colors.primary}
                            disabled={!hapticSettings.enabled}
                        />
                        <View style={styles.sliderLabels}>
                            <Text style={[styles.sliderLabel, { color: theme.colors.textSecondary }]}>
                                Subtle
                            </Text>
                            <Text style={[styles.sliderLabel, { color: theme.colors.textSecondary }]}>
                                Intense
                            </Text>
                        </View>
                    </View>

                    {/* Tip */}
                    <View style={[styles.tipCard, { backgroundColor: theme.colors.card }]}>
                        <Feather name="info" size={16} color={theme.colors.primary} />
                        <Text style={[styles.tipText, { color: theme.colors.textSecondary }]}>
                            Use Light for quiet environments, Strong for outdoors or noisy places.
                            Adjust during playback via QuickSettings.
                        </Text>
                    </View>

                    {/* Reset Button */}
                    <TouchableOpacity
                        style={[styles.resetButton, { backgroundColor: theme.colors.card }]}
                        onPress={handleResetHaptics}
                        activeOpacity={0.7}>
                        <Text style={[styles.resetButtonText, { color: theme.colors.textSecondary }]}>
                            Reset to Default
                        </Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                        Subtitles
                    </Text>


                    {/* Subtitle Appearance */}
                    <View style={[styles.item, { backgroundColor: theme.colors.card }]}>
                        <Text style={[styles.itemLabel, { color: theme.colors.text }]}>Appearance</Text>
                    </View>

                    {/* VISUALIZER PREVIEW (Reanimated) */}
                    <SubtitlePreviewSection fontSizeSV={fontSizeSV} settings={settings} theme={theme} />

                    {/* Pinch-to-zoom tip */}
                    <View style={[styles.tipCard, { backgroundColor: theme.colors.card }]}>
                        <Feather name="info" size={16} color={theme.colors.textSecondary} />
                        <Text style={[styles.tipText, { color: theme.colors.textSecondary }]}>
                            Tip: You can pinch-to-zoom subtitles in the player to adjust size on-the-fly, or drag to reposition.
                        </Text>
                    </View>

                    {/* Reset All Button */}
                    <TouchableOpacity
                        style={[styles.resetButton, { backgroundColor: theme.colors.card, marginBottom: 16 }]}
                        onPress={resetSubtitleSettings}
                    >
                        <Feather name="refresh-cw" size={14} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                        <Text style={[styles.resetButtonText, { color: theme.colors.textSecondary }]}>Reset to Defaults</Text>
                    </TouchableOpacity>

                    {/* Font Size Slider (Isolated) */}
                    <FontSizeSliderControl
                        fontSizeSV={fontSizeSV}
                        onFinalChange={setSubtitleFontSize}
                        theme={theme}
                    />

                    {/* Font Weight Slider */}
                    <View style={[styles.sliderCard, { backgroundColor: theme.colors.card }]}>
                        <View style={styles.sliderHeader}>
                            <Text style={[styles.itemLabel, { color: theme.colors.text }]}>Weight</Text>
                            <Text style={{ color: theme.colors.textSecondary }}>{Math.round(settings.subtitleFontWeight)}</Text>
                        </View>
                        <Slider
                            style={styles.slider}
                            minimumValue={300}
                            maximumValue={900}
                            step={100}
                            value={settings.subtitleFontWeight}
                            onValueChange={setSubtitleFontWeight}
                            minimumTrackTintColor={theme.colors.primary}
                            maximumTrackTintColor={theme.colors.border}
                            thumbTintColor={theme.colors.primary}
                        />
                    </View>

                    {/* Font Color */}
                    <View style={[styles.controlRow, { borderColor: theme.colors.border }]}>
                        <Text style={[styles.controlLabel, { color: theme.colors.text }]}>Color</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorScroll}>
                            {SUBTITLE_COLORS?.map(color => (
                                <TouchableOpacity
                                    key={color.value}
                                    style={[
                                        styles.colorSwatch,
                                        { backgroundColor: color.value },
                                        settings.subtitleColor === color.value && { borderWidth: 2, borderColor: theme.colors.primary },
                                    ]}
                                    onPress={() => setSubtitleColor(color.value)}
                                />
                            ))}
                        </ScrollView>
                    </View>

                    {/* Background Style */}
                    <View style={[styles.controlRow, { borderColor: theme.colors.border }]}>
                        <Text style={[styles.controlLabel, { color: theme.colors.text }]}>Style</Text>
                        <View style={styles.optionsRow}>
                            {['none', 'outline', 'box'].map(opt => {
                                const isSelected = opt === 'box'
                                    ? settings.subtitleBackgroundColor !== 'transparent' && settings.subtitleEdgeStyle === 'none'
                                    : (opt === 'none' ? settings.subtitleEdgeStyle === 'none' && settings.subtitleBackgroundColor === 'transparent'
                                        : settings.subtitleEdgeStyle === 'outline');

                                return (
                                    <TouchableOpacity
                                        key={opt}
                                        style={[
                                            styles.optionButton,
                                            isSelected && { backgroundColor: theme.colors.primary },
                                        ]}
                                        onPress={() => {
                                            if (opt === 'none') {
                                                setSubtitleBackgroundColor('transparent');
                                                setSubtitleEdgeStyle('none');
                                            } else if (opt === 'outline') {
                                                setSubtitleBackgroundColor('transparent');
                                                setSubtitleEdgeStyle('outline');
                                            } else {
                                                setSubtitleBackgroundColor('#000000'); // Default black box
                                                setSubtitleEdgeStyle('none');
                                            }
                                        }}
                                    >
                                        <Text style={[styles.optionButtonText, { color: isSelected ? '#FFF' : theme.colors.text }]}>
                                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>

                    {/* Outline Width Slider (Only if Outline style) */}
                    {settings.subtitleEdgeStyle === 'outline' && (
                        <View style={[styles.sliderCard, { backgroundColor: theme.colors.card }]}>
                            <View style={styles.sliderHeader}>
                                <Text style={[styles.itemLabel, { color: theme.colors.text }]}>Outline Width</Text>
                                <Text style={{ color: theme.colors.textSecondary }}>{settings.subtitleOutlineWidth.toFixed(1)}</Text>
                            </View>
                            <Slider
                                style={styles.slider}
                                minimumValue={0.5}
                                maximumValue={6}
                                value={settings.subtitleOutlineWidth}
                                onValueChange={setSubtitleOutlineWidth}
                                minimumTrackTintColor={theme.colors.primary}
                                maximumTrackTintColor={theme.colors.border}
                                thumbTintColor={theme.colors.primary}
                            />
                        </View>
                    )}

                    {/* Background Opacity (Only if Box) */}
                    {settings.subtitleBackgroundColor !== 'transparent' && (
                        <View style={[styles.sliderCard, { backgroundColor: theme.colors.card }]}>
                            <View style={styles.sliderHeader}>
                                <Text style={[styles.itemLabel, { color: theme.colors.text }]}>Opacity</Text>
                                <Text style={{ color: theme.colors.textSecondary }}>{Math.round(settings.subtitleBackgroundOpacity * 100)}%</Text>
                            </View>
                            <Slider
                                style={styles.slider}
                                minimumValue={0}
                                maximumValue={1}
                                value={settings.subtitleBackgroundOpacity}
                                onValueChange={setSubtitleBackgroundOpacity}
                                minimumTrackTintColor={theme.colors.primary}
                                maximumTrackTintColor={theme.colors.border}
                                thumbTintColor={theme.colors.primary}
                            />
                        </View>
                    )}
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                        Storage
                    </Text>
                    <TouchableOpacity
                        style={[styles.button, { backgroundColor: theme.colors.error }]}
                        onPress={handleClearCache}>
                        <Text style={styles.buttonText}>Clear Subtitle Cache</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.button, { backgroundColor: theme.colors.error, marginTop: 12 }]}
                        onPress={handleClearHistory}>
                        <Text style={styles.buttonText}>Clear Watch History</Text>
                    </TouchableOpacity>
                </View>

                {/* Language Selection Modal */}
                <Modal
                    visible={languageModalVisible}
                    transparent={true}
                    animationType="slide"
                    navigationBarTranslucent
                    statusBarTranslucent
                    onRequestClose={() => setLanguageModalVisible(false)}
                >
                    <TouchableOpacity
                        style={styles.modalOverlay}
                        activeOpacity={1}
                        onPress={() => setLanguageModalVisible(false)}
                    >
                        <View style={[styles.modalContent, { backgroundColor: theme.colors.card }]}>
                            {/* Handle Bar */}
                            <View style={{ alignItems: 'center', marginBottom: 16 }}>
                                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border }} />
                            </View>

                            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Select Audio Language</Text>

                            {/* Search Bar - Sleek */}
                            <View style={[styles.searchContainer, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
                                <Feather name="search" size={20} color={theme.colors.textSecondary} style={{ marginRight: 10 }} />
                                <TextInput
                                    style={[styles.searchInput, { color: theme.colors.text }]}
                                    placeholder="Search language..."
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                    autoFocus={false}
                                />
                                {searchQuery.length > 0 && (
                                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                                        <Feather name="x-circle" size={18} color={theme.colors.textSecondary} />
                                    </TouchableOpacity>
                                )}
                            </View>

                            <FlatList
                                data={filteredLanguages}
                                keyExtractor={(item) => item.code}
                                contentContainerStyle={{ paddingBottom: 20 }}
                                renderItem={({ item }) => {
                                    const isSelected = item.code === 'auto'
                                        ? settings.defaultAudioLanguage === null
                                        : settings.defaultAudioLanguage === item.name;

                                    return (
                                        <TouchableOpacity
                                            style={[
                                                styles.languageOption,
                                                { borderBottomColor: theme.colors.border },
                                            ]}
                                            onPress={() => {
                                                setDefaultAudioLanguage(item.code === 'auto' ? null : item.name);
                                                setLanguageModalVisible(false);
                                                setSearchQuery(''); // Reset search
                                            }}
                                        >
                                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                <View style={[
                                                    styles.radioCircle,
                                                    { borderColor: isSelected ? theme.colors.primary : theme.colors.textSecondary },
                                                ]}>
                                                    {isSelected && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
                                                </View>
                                                <View style={{ marginLeft: 16 }}>
                                                    <Text style={[
                                                        styles.languageText,
                                                        { color: theme.colors.text },
                                                        isSelected && { fontWeight: 'bold' },
                                                    ]}>
                                                        {item.name}
                                                    </Text>
                                                    {item.nativeName && item.code !== 'auto' && (
                                                        <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 }}>
                                                            {item.nativeName}
                                                        </Text>
                                                    )}
                                                </View>
                                            </View>
                                            {item.code === 'auto' && (
                                                <View style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: theme.colors.primary + '20', borderRadius: 4 }}>
                                                    <Text style={{ fontSize: 10, color: theme.colors.primary, fontWeight: 'bold' }}>DEFAULT</Text>
                                                </View>
                                            )}
                                        </TouchableOpacity>
                                    );
                                }}
                            />
                        </View>
                    </TouchableOpacity>
                </Modal>

            </ScrollView >
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    updateCard: {
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 12,
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    updateHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    updateIconWrap: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.08)',
        marginRight: 12,
    },
    updateTextBlock: {
        flex: 1,
    },
    updateTitle: {
        fontSize: 14,
        fontWeight: '700',
    },
    updateSubtitle: {
        marginTop: 2,
        fontSize: 12,
    },
    updateButton: {
        marginTop: 12,
        paddingVertical: 10,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    updateButtonText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#000',
    },
    section: {
        padding: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 12,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderRadius: 8,
        marginBottom: 8,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    itemContent: {
        flex: 1,
        marginRight: 12,
    },
    itemLabel: {
        fontSize: 16,
        fontWeight: '500',
    },
    itemDescription: {
        fontSize: 12,
        marginTop: 4,
    },
    itemValue: {
        fontSize: 16,
    },
    presetsCard: {
        padding: 16,
        borderRadius: 8,
        marginBottom: 8,
    },
    presetsTitle: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 12,
    },
    presetsRow: {
        flexDirection: 'row',
        gap: 8,
    },
    input: {
        width: '100%',
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        marginTop: 12,
        fontSize: 16,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end', // Bottom sheet alignment
    },
    modalContent: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        maxHeight: '80%',
        minHeight: '50%',
        width: '100%',
        paddingBottom: 40, // Safe area
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        height: 50,
        marginBottom: 16,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        height: '100%',
    },
    languageOption: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 16,
        paddingHorizontal: 4,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    languageText: {
        fontSize: 16,
    },
    radioCircle: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    presetButton: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderRadius: 10,
        borderWidth: 1,
        gap: 4,
    },
    presetLabel: {
        fontSize: 13,
        fontWeight: '600',
    },
    presetDescription: {
        fontSize: 10,
    },
    // New Subtitle UI Styles
    previewContainer: {
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        alignItems: 'center',
    },
    previewText: {
        fontSize: 12,
        fontWeight: '600',
    },
    previewVideoFrame: {
        width: '100%',
        height: 100,
        borderRadius: 6,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
        position: 'relative',
    },
    controlRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        marginBottom: 4,
    },
    controlLabel: {
        fontSize: 14,
        fontWeight: '500',
    },
    optionButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        marginLeft: 8,
    },
    optionButtonText: {
        fontSize: 13,
        fontWeight: '500',
    },
    optionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    colorScroll: {
        paddingVertical: 4,
    },
    colorSwatch: {
        width: 32,
        height: 32,
        borderRadius: 16,
        marginLeft: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    sliderCard: {
        padding: 16,
        borderRadius: 8,
        marginBottom: 8,
    },
    sliderHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    intensityValue: {
        fontSize: 13,
        fontWeight: '600',
    },
    slider: {
        width: '100%',
        height: 40,
    },
    sliderLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    sliderLabel: {
        fontSize: 11,
    },
    tipCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
        gap: 10,
    },
    tipText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 18,
    },
    option: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
    },
    optionText: {
        fontSize: 14,
        fontWeight: '600',
    },
    colorOption: {
        width: 40,
        height: 40,
        borderRadius: 20,
    },
    resetButton: {
        flexDirection: 'row',
        padding: 12,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    resetButtonText: {
        fontSize: 14,
        fontWeight: '500',
    },
    button: {
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    // New Header Styles
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 16,
        gap: 16,
    },
    backButton: {
        width: 42,
        height: 42,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    headerInfo: {
        flex: 1,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        letterSpacing: -0.5,
    },
});
