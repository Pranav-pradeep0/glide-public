import React, {
    useState,
    useRef,
    useCallback,
    useEffect,
    useMemo,
} from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    InteractionManager,
    useWindowDimensions,
    Pressable,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    type LayoutChangeEvent,
} from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    cancelAnimation,
    Easing,
} from 'react-native-reanimated';

import { useAppStore } from '../store/appStore';
import { useTheme } from '../hooks/useTheme';
import PlaybackIcon from '../components/onboarding/PlaybackIcon';
import FeatureShowcaseIcon from '../components/onboarding/FeatureShowcaseIcon';
import PrivacyIcon from '../components/onboarding/PrivacyIcon';

// ─── Constants ────────────────────────────────────────────────────────────────
const BTN_H = 52;
const BTN_RADIUS = 16;
const GAP = 10;
const FOOTER_PAD = 28;
const FOOTER_HEIGHT = 8 + 16 + BTN_H + 48;

const TOTAL = 3;
const LAST = TOTAL - 1;

// ─── Worklet helpers ──────────────────────────────────────────────────────────
// Pure arithmetic — no imports, worklet-safe, zero overhead.

function clamp01(t: number): number {
    'worklet';
    return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Normalise global progress `p` into [0, 1] over the sub-window [start, end].
 * Returns 0 before `start`, 1 after `end` — never throws.
 */
function phaseT(p: number, start: number, end: number): number {
    'worklet';
    return clamp01((p - start) / (end - start));
}

/** Smooth symmetric ease — reads as "natural" body motion. */
function easeInOut(t: number): number {
    'worklet';
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Fast deceleration — ideal for expanding / growing elements. */
function easeOutQuart(t: number): number {
    'worklet';
    return 1 - Math.pow(1 - t, 4);
}

/** Gentle deceleration — ideal for text reveals. */
function easeOutCubic(t: number): number {
    'worklet';
    return 1 - Math.pow(1 - t, 3);
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface SlideData {
    id: string;
    title: string;
    tagline: string;
    bullets: string[];
}

const SLIDES: SlideData[] = [
    {
        id: '1',
        title: 'Just the Usuals',
        tagline: 'Use it like every other player. Nothing fancy.',
        bullets: [
            'Smooth gesture controls',
            'Fully customizable subtitles',
            'Everything fast.. very.',
        ],
    },
    {
        id: '2',
        title: 'Things You Might Like',
        tagline: 'Experimental features. Working just for now..',
        bullets: [
            'Color enhancement',
            'Sync your subtitles in a better way. No more millisecond headaches.',
            'Haptic enabled movie playback.',
        ],
    },
    {
        id: '3',
        title: 'Safe and Open Source',
        tagline: 'You\'re the only one watching.',
        bullets: [
            'Zero data collection',
            'Free forever, no ads',
            'Anything feels slow ? Clone it, optimize it.',
        ],
    },
];

// ─── SlideItem ────────────────────────────────────────────────────────────────
interface SlideItemProps {
    item: SlideData;
    isActive: boolean;
    shouldAnimate: boolean;
    keepMounted: boolean;
    slideWidth: number;
    activeFeatureIndex: number;
    onFeatureActivate?: (index: number) => void;
    themeColors: {
        text: string;
        textSecondary: string;
        background: string;
        border: string;
        primary: string;
    };
}

const SlideItem = React.memo<SlideItemProps>(
    ({
        item,
        isActive,
        shouldAnimate,
        keepMounted,
        slideWidth,
        activeFeatureIndex,
        onFeatureActivate,
        themeColors,
    }) => {
        const [animateReady, setAnimateReady] = useState(false);

        useEffect(() => {
            if (!isActive || !shouldAnimate) {
                setAnimateReady(false);
                return;
            }
            const task = InteractionManager.runAfterInteractions(() =>
                setAnimateReady(true),
            );
            return () => {
                task.cancel();
                setAnimateReady(false);
            };
        }, [isActive, shouldAnimate]);

        const animate = isActive && shouldAnimate && animateReady;
        const stormAnimate = isActive && shouldAnimate;

        const iconElement = useMemo(() => {
            const p = {
                color: themeColors.text,
                secondaryColor: themeColors.textSecondary,
            };
            switch (item.id) {
                case '1': return <PlaybackIcon {...p} animate={animate} />;
                case '2': return <FeatureShowcaseIcon {...p} animate={stormAnimate} onFeatureActivate={onFeatureActivate} />;
                case '3': return <PrivacyIcon {...p} animate={animate} />;
                default: return null;
            }
        }, [item.id, animate, stormAnimate, themeColors.text, themeColors.textSecondary, onFeatureActivate]);

        return (
            <View style={[slideStyles.slide, { width: slideWidth }]}>
                <View style={slideStyles.content}>
                    <View style={slideStyles.iconContainer}>
                        {keepMounted
                            ? iconElement
                            : <View style={slideStyles.iconPlaceholder} />
                        }
                    </View>
                    <Text style={[slideStyles.title, { color: themeColors.text }]}>
                        {item.title}
                    </Text>
                    <Text style={[slideStyles.tagline, { color: themeColors.textSecondary }]}>
                        {item.tagline}
                    </Text>
                    <View style={slideStyles.bulletsContainer}>
                        {item.bullets.map((bullet, i) => {
                            const isSlide2 = item.id === '2';
                            const highlighted = isSlide2 && i <= activeFeatureIndex;
                            return (
                                <View key={i} style={slideStyles.bulletRow}>
                                    <View
                                        style={[
                                            slideStyles.bulletDot,
                                            {
                                                backgroundColor: highlighted
                                                    ? themeColors.primary
                                                    : themeColors.textSecondary,
                                            },
                                        ]}
                                    />
                                    <Text
                                        style={[
                                            slideStyles.bulletText,
                                            {
                                                color: themeColors.text,
                                                opacity: isSlide2 ? (highlighted ? 1 : 0.4) : 1,
                                            },
                                        ]}
                                    >
                                        {bullet}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>
                </View>
            </View>
        );
    },
    (prev, next) =>
        prev.isActive === next.isActive &&
        prev.shouldAnimate === next.shouldAnimate &&
        prev.keepMounted === next.keepMounted &&
        prev.slideWidth === next.slideWidth &&
        prev.item.id === next.item.id &&
        prev.activeFeatureIndex === next.activeFeatureIndex &&
        prev.themeColors === next.themeColors,
);
SlideItem.displayName = 'SlideItem';

// ─── Pagination ───────────────────────────────────────────────────────────────
interface PaginationProps {
    total: number;
    currentIndex: number;
    activeColor: string;
    inactiveColor: string;
}

const Pagination = React.memo<PaginationProps>(({
    total,
    currentIndex,
    activeColor,
    inactiveColor,
}) => (
    <View style={paginationStyles.row}>
        {Array.from({ length: total }).map((_, i) => (
            <View
                key={i}
                style={[
                    paginationStyles.dot,
                    {
                        width: i === currentIndex ? 24 : 8,
                        backgroundColor: i === currentIndex ? activeColor : inactiveColor,
                    },
                ]}
            />
        ))}
    </View>
));
Pagination.displayName = 'Pagination';

// ─── MergingCTA ───────────────────────────────────────────────────────────────
/**
 * Single animation driver `progress` (0 → 1, 680 ms linear).
 * One withTiming call. Zero JS callbacks between phases.
 * Every animated property derives its own curve from pure worklet math.
 *
 * Phase map  (progress 0 → 1 = 0 → 680 ms):
 *   Buttons slide + fade   [0.00 → 0.55]   easeInOut
 *   Pill fade-in           [0.30 → 0.50]   linear     ← overlaps with button fade
 *   Pill expand            [0.32 → 0.82]   easeOutQuart
 *   Text reveal            [0.74 → 1.00]   easeOutCubic
 *
 * The overlap between button fade-out and pill fade-in produces a natural
 * crossfade so the eye never sees an empty row.
 *
 * Reverse: cancelAnimation + direct assignment — no animation, no flash.
 *
 * containerWsv (shared value) carries the container width into worklets so
 * animated styles always read the live value — never a stale JS closure.
 */
interface MergingCTAProps {
    isLastSlide: boolean;
    onNext: () => void;
    onSkip: () => void;
    primaryColor: string;
    backgroundColor: string;
    textColor: string;
    borderColor: string;
    dark: boolean;
}

const MergingCTA = React.memo<MergingCTAProps>(({
    isLastSlide,
    onNext,
    onSkip,
    primaryColor,
    backgroundColor,
    textColor,
    borderColor,
    dark,
}) => {
    /**
     * containerW (state) — drives layout: static `width` prop on button wrappers.
     * containerWsv (shared value) — read inside worklets for animation math.
     * Both set together in onLayout; one re-render, no stale reads thereafter.
     */
    const [containerW, setContainerW] = useState(0);
    const containerWsv = useSharedValue(0);

    const btnTextColor = dark ? backgroundColor : '#FFFFFF';

    // The sole animation driver. Easing is linear here;
    // per-property curves are applied inside each worklet.
    const progress = useSharedValue(0);

    // ── Orchestration ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!isLastSlide) {
            // Cancel in-progress forward animation and snap instantly.
            cancelAnimation(progress);
            progress.value = 0;
            return;
        }
        progress.value = withTiming(1, { duration: 680, easing: Easing.linear });
    }, [isLastSlide]);

    // ── Animated styles ────────────────────────────────────────────────────
    // All properties computed from `progress` and `containerWsv` on the UI thread.

    const skipStyle = useAnimatedStyle(() => {
        const cw = containerWsv.value;
        if (!cw) return { opacity: 0 };

        const bw = (cw - GAP) / 2;
        const t = easeInOut(phaseT(progress.value, 0, 0.55));
        const half = bw / 2 + GAP / 2;

        return {
            transform: [{ translateX: t * half }],
            opacity: 1 - t,
        };
    });

    const nextStyle = useAnimatedStyle(() => {
        const cw = containerWsv.value;
        if (!cw) return { opacity: 0 };

        const bw = (cw - GAP) / 2;
        const t = easeInOut(phaseT(progress.value, 0, 0.55));
        const half = bw / 2 + GAP / 2;

        return {
            transform: [{ translateX: -(t * half) }],
            opacity: 1 - t,
        };
    });

    const pillStyle = useAnimatedStyle(() => {
        const cw = containerWsv.value;
        if (!cw) return { opacity: 0 };

        const bw = (cw - GAP) / 2;
        const expand = easeOutQuart(phaseT(progress.value, 0.32, 0.82));
        const fadeIn = phaseT(progress.value, 0.30, 0.50); // linear: just fade as it grows in

        return {
            width: bw + expand * (cw - bw),
            borderRadius: BTN_RADIUS + expand * (BTN_H / 2 - BTN_RADIUS),
            opacity: fadeIn,
        };
    });

    const labelStyle = useAnimatedStyle(() => {
        const t = easeOutCubic(phaseT(progress.value, 0.74, 1.0));
        return {
            opacity: t,
            transform: [{ translateY: (1 - t) * 6 }],
        };
    });

    const onLayout = useCallback((e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        setContainerW(w);
        containerWsv.value = w;
    }, []);

    const btnW = containerW > 0 ? (containerW - GAP) / 2 : 0;

    return (
        <View style={ctaStyles.row} onLayout={onLayout}>
            {containerW > 0 && (
                <>
                    {/* ── Skip ── */}
                    <Animated.View
                        style={[
                            ctaStyles.btnWrapper,
                            { width: btnW, borderRadius: BTN_RADIUS },
                            skipStyle,
                        ]}
                    >
                        <Pressable
                            onPress={onSkip}
                            style={({ pressed }) => [
                                ctaStyles.btn,
                                {
                                    borderColor,
                                    borderWidth: 1.5,
                                    backgroundColor: 'transparent',
                                },
                                pressed && ctaStyles.btnPressed,
                            ]}
                            android_ripple={{ color: borderColor, borderless: false }}
                        >
                            <Text style={[ctaStyles.label, { color: textColor, opacity: 0.55 }]}>
                                Skip
                            </Text>
                        </Pressable>
                    </Animated.View>

                    {/* ── Next ── */}
                    <Animated.View
                        style={[
                            ctaStyles.btnWrapper,
                            { width: btnW, borderRadius: BTN_RADIUS },
                            nextStyle,
                        ]}
                    >
                        <Pressable
                            onPress={onNext}
                            style={({ pressed }) => [
                                ctaStyles.btn,
                                { backgroundColor: primaryColor },
                                pressed && ctaStyles.btnPressed,
                            ]}
                            android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
                        >
                            <Text style={[ctaStyles.label, { color: btnTextColor }]}>Next</Text>
                        </Pressable>
                    </Animated.View>

                    {/* ── Get Started pill (right-anchored, expands leftward) ── */}
                    <Animated.View
                        pointerEvents={isLastSlide ? 'auto' : 'none'}
                        style={[
                            ctaStyles.pill,
                            { backgroundColor: primaryColor, height: BTN_H },
                            pillStyle,
                        ]}
                    >
                        <Pressable
                            onPress={onNext}
                            style={({ pressed }) => [
                                ctaStyles.pillInner,
                                pressed && ctaStyles.btnPressed,
                            ]}
                            android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
                        >
                            <Animated.Text
                                style={[ctaStyles.label, { color: btnTextColor }, labelStyle]}
                                numberOfLines={1}
                            >
                                Get Started
                            </Animated.Text>
                        </Pressable>
                    </Animated.View>
                </>
            )}
        </View>
    );
},
    (prev, next) =>
        prev.isLastSlide === next.isLastSlide &&
        prev.primaryColor === next.primaryColor &&
        prev.backgroundColor === next.backgroundColor &&
        prev.textColor === next.textColor &&
        prev.borderColor === next.borderColor &&
        prev.dark === next.dark,
);
MergingCTA.displayName = 'MergingCTA';

// ─── OnboardingScreen ─────────────────────────────────────────────────────────
export default function OnboardingScreen() {
    const theme = useTheme();
    const { completeOnboarding } = useAppStore();
    const { width: screenWidth } = useWindowDimensions();

    const [currentIndex, setCurrentIndex] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const [activeFeatureIndex, setActiveFeatureIndex] = useState(-1);

    const flatListRef = useRef<FlatList<SlideData>>(null);

    const getItemLayout = useCallback(
        (_: unknown, index: number) => ({
            length: screenWidth,
            offset: screenWidth * index,
            index,
        }),
        [screenWidth],
    );

    const handleNext = useCallback(() => {
        if (currentIndex < LAST) {
            setIsSwiping(true);
            flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
        } else {
            completeOnboarding();
        }
    }, [currentIndex, completeOnboarding]);

    const handleSkip = useCallback(() => completeOnboarding(), [completeOnboarding]);
    const handleDrag = useCallback(() => setIsSwiping(true), []);
    const handleFeatureActivate = useCallback((i: number) => setActiveFeatureIndex(i), []);

    const handleMomentumEnd = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
            setCurrentIndex(Math.max(0, Math.min(LAST, next)));
            setIsSwiping(false);
        },
        [screenWidth],
    );

    const renderItem = useCallback(
        ({ item, index }: { item: SlideData; index: number }) => (
            <SlideItem
                item={item}
                isActive={index === currentIndex}
                shouldAnimate={!isSwiping}
                keepMounted={Math.abs(index - currentIndex) <= 1}
                slideWidth={screenWidth}
                activeFeatureIndex={activeFeatureIndex}
                onFeatureActivate={index === 1 ? handleFeatureActivate : undefined}
                themeColors={theme.colors}
            />
        ),
        [currentIndex, isSwiping, screenWidth, activeFeatureIndex, handleFeatureActivate, theme.colors],
    );

    return (
        <View style={[screenStyles.container, { backgroundColor: theme.colors.background }]}>
            <FlatList
                ref={flatListRef}
                data={SLIDES}
                renderItem={renderItem}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={item => item.id}
                onScrollBeginDrag={handleDrag}
                onMomentumScrollEnd={handleMomentumEnd}
                getItemLayout={getItemLayout}
                windowSize={3}
                initialNumToRender={2}
                maxToRenderPerBatch={2}
                removeClippedSubviews
            />

            <View style={[screenStyles.footer, { paddingHorizontal: FOOTER_PAD }]}>
                <Pagination
                    total={TOTAL}
                    currentIndex={currentIndex}
                    activeColor={theme.colors.text}
                    inactiveColor={theme.colors.border}
                />
                <MergingCTA
                    isLastSlide={currentIndex === LAST}
                    onNext={handleNext}
                    onSkip={handleSkip}
                    primaryColor={theme.colors.primary}
                    backgroundColor={theme.colors.background}
                    textColor={theme.colors.text}
                    borderColor={theme.colors.border}
                    dark={theme.dark}
                />
            </View>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const slideStyles = StyleSheet.create({
    slide: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { paddingHorizontal: 36, alignItems: 'center', width: '100%' },
    iconContainer: { marginBottom: 32, height: 200, justifyContent: 'center', alignItems: 'center' },
    iconPlaceholder: { width: 340, height: 200 },
    title: { fontSize: 28, fontWeight: 'bold', marginBottom: 6, textAlign: 'center', letterSpacing: 0.3 },
    tagline: { fontSize: 15, fontStyle: 'italic', marginBottom: 24, textAlign: 'center' },
    bulletsContainer: { alignSelf: 'flex-start', paddingLeft: 8, marginBottom: 16 },
    bulletRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    bulletDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 12 },
    bulletText: { fontSize: 14, lineHeight: 20 },
});

const paginationStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        height: 8,
        marginBottom: 16,
        gap: 6,
    },
    dot: { height: 8, borderRadius: 4 },
});

const ctaStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: GAP,
        height: BTN_H,
        position: 'relative',
    },
    btnWrapper: {
        overflow: 'hidden',
    },
    btn: {
        height: BTN_H,
        borderRadius: BTN_RADIUS,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
    },
    label: {
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
    pill: {
        position: 'absolute',
        right: 0,
        top: 0,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    pillInner: {
        flex: 1,
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    btnPressed: {
        opacity: 0.78,
    },
});

const screenStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    footer: {
        height: FOOTER_HEIGHT,
        justifyContent: 'flex-end',
        paddingBottom: 48,
    },
});