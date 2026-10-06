import React, { useEffect, useRef, useCallback } from 'react';
import { DefaultTheme, NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useAppStore } from '../store/appStore';
import { useTheme } from '../hooks/useTheme';
import { Feather } from '@react-native-vector-icons/feather';
import { DeepLinkService } from '../services/DeepLinkService';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Touchable, SnackbarHost } from '@/components/ui';
import { metrics, type } from '@/theme/theme';

import OnboardingScreen from '@/screens/OnboardingScreen';
import RecentsScreen from '@/screens/RecentsScreen';
import SettingsScreen from '@/screens/SettingsScreen';
import FoldersScreen from '@/screens/FoldersScreen';
import SearchScreen from '@/screens/SearchScreen';
import PlayerDetailScreen from '@/screens/PlayerDetailScreen';
import VideoPlayerScreen from '@/screens/VideoPlayerScreen';
import AlbumVideosScreen from '@/screens/AlbumVideosScreen';
import { MainTabParamList, RootStackParamList } from '@/types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_HEIGHT = 64;

// React Navigation calls `tabBar` as a plain function, so TabBar must be rendered as an element to use hooks.
const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
    const { colors } = useTheme();
    return (
        <View
            style={[
                styles.tabBar,
                {
                    backgroundColor: colors.surface,
                    borderTopColor: colors.border,
                    paddingBottom: insets.bottom,
                    height: TAB_HEIGHT + insets.bottom,
                },
            ]}
        >
            {state.routes.map((route, index) => {
                const { options } = descriptors[route.key];
                const focused = state.index === index;
                const label = options.title ?? route.name;
                const onPress = () => {
                    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                    if (!focused && !event.defaultPrevented) {
                        navigation.navigate(route.name, route.params);
                    }
                };
                return (
                    <Touchable
                        key={route.key}
                        onPress={onPress}
                        scaleTo={1}
                        accessibilityRole="tab"
                        accessibilityLabel={label}
                        accessibilityState={{ selected: focused }}
                        style={styles.tab}
                    >
                        <View style={styles.pill}>
                            {/* Mounted fresh with its colour: Fabric drops borderRadius when a background is added to an existing view. */}
                            {focused && <View style={[styles.pillFill, { backgroundColor: colors.primaryContainer }]} />}
                            {options.tabBarIcon?.({ focused, color: focused ? colors.primary : colors.textSecondary, size: 24 })}
                        </View>
                        <Text style={[type.caption, styles.label, { color: focused ? colors.text : colors.textSecondary }]}>
                            {label}
                        </Text>
                    </Touchable>
                );
            })}
        </View>
    );
}

function MainTabs() {
    const { colors } = useTheme();
    const { updateStatus } = useAppStore();

    return (
        <Tab.Navigator
            tabBar={renderTabBar}
            screenOptions={{ headerShown: false, lazy: true }}
        >
            <Tab.Screen
                name="Folders"
                component={FoldersScreen}
                options={{
                    title: 'Folders',
                    tabBarIcon: ({ color }) => <Feather name="folder" size={22} color={color} />,
                }}
            />
            <Tab.Screen
                name="Recents"
                component={RecentsScreen}
                options={{
                    title: 'Recents',
                    tabBarIcon: ({ color }) => <Feather name="clock" size={22} color={color} />,
                }}
            />
            <Tab.Screen
                name="Settings"
                component={SettingsScreen}
                options={{
                    title: 'Settings',
                    tabBarIcon: ({ color }) => (
                        <View>
                            <Feather name="settings" size={22} color={color} />
                            {updateStatus.available && <View style={[styles.badge, { backgroundColor: colors.primary }]} />}
                        </View>
                    ),
                }}
            />
        </Tab.Navigator>
    );
}

interface RootNavigatorProps {
    onReady?: () => void;
}

export default function RootNavigator({ onReady }: RootNavigatorProps) {
    const { settings } = useAppStore();
    const theme = useTheme();
    const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

    useEffect(() => {
        const handleUrl = (url: string) => {
            if (__DEV__) { console.log('[RootNavigator] URL event received:', url); }
            if (DeepLinkService.isVideoUri(url)) {
                if (__DEV__) { console.log('[RootNavigator] Received video URL in main activity, ignoring'); }
            }
        };
        const unsubscribe = DeepLinkService.addUrlListener(handleUrl);
        return unsubscribe;
    }, []);

    const onNavigationReady = useCallback(() => {
        if (__DEV__) { console.log('[RootNavigator] Navigation ready'); }
        // Wait for one frame to ensure paint has started
        requestAnimationFrame(() => {
            onReady?.();
        });
    }, [onReady]);

    return (
        <NavigationContainer
            ref={navigationRef}
            onReady={onNavigationReady}
            theme={{
                ...DefaultTheme,
                dark: theme.dark,
                colors: {
                    primary: theme.colors.primary,
                    background: theme.colors.background,
                    card: theme.colors.surface,
                    text: theme.colors.text,
                    border: theme.colors.border,
                    notification: theme.colors.primary,
                },
            }}
        >
            <Stack.Navigator
                screenOptions={{
                    headerShown: false,
                    animation: Platform.OS === 'ios' ? 'ios_from_right' : 'slide_from_right',
                    animationDuration: Platform.OS === 'ios' ? 260 : 220,
                    animationMatchesGesture: true,
                    gestureEnabled: true,
                    fullScreenGestureEnabled: Platform.OS === 'ios',
                    contentStyle: { backgroundColor: theme.colors.background },
                }}
            >
                {!settings.hasCompletedOnboarding ? (
                    <Stack.Screen
                        name="Onboarding"
                        component={OnboardingScreen}
                    />
                ) : (
                    <>
                        <Stack.Screen
                            name="MainTabs"
                            component={MainTabs}
                        />
                        <Stack.Screen
                            name="PlayerDetail"
                            component={PlayerDetailScreen}
                            options={{
                                animation: Platform.OS === 'ios' ? 'ios_from_right' : 'slide_from_right',
                            }}
                        />
                        <Stack.Screen
                            name="AlbumVideos"
                            component={AlbumVideosScreen}
                            options={{
                                headerShown: false,
                                animation: 'slide_from_right',
                            }}
                        />
                        <Stack.Screen
                            name="VideoPlayer"
                            component={VideoPlayerScreen}
                            options={{
                                headerShown: false,
                                animation: Platform.OS === 'ios' ? 'ios_from_right' : 'slide_from_right',
                                animationDuration: Platform.OS === 'ios' ? 220 : 200,
                                gestureEnabled: false,
                            }}
                        />
                        <Stack.Screen
                            name="Search"
                            component={SearchScreen}
                            options={{
                                headerShown: false,
                                animation: 'slide_from_right',
                            }}
                        />
                    </>
                )}
            </Stack.Navigator>
            <SnackbarHost bottomOffset={TAB_HEIGHT} />
        </NavigationContainer>
    );
}

const styles = StyleSheet.create({
    tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: metrics.space.xs },
    pill: { width: 56, height: 32, alignItems: 'center', justifyContent: 'center' },
    pillFill: { ...StyleSheet.absoluteFill, borderRadius: 16 },
    label: { fontWeight: '500' },
    badge: { position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4 },
});
