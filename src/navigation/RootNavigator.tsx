import React, { useEffect, useRef, useCallback } from 'react';
import { DefaultTheme, NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAppStore } from '../store/appStore';
import { useTheme } from '../hooks/useTheme';
import { Feather } from '@react-native-vector-icons/feather';
import { DeepLinkService } from '../services/DeepLinkService';
import { BlurView } from '@react-native-community/blur';
import { Platform, StyleSheet, View } from 'react-native';

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

function MainTabs() {
    const theme = useTheme();

    return (
        <Tab.Navigator
            screenOptions={{
                tabBarActiveTintColor: theme.colors.primary,
                tabBarInactiveTintColor: theme.colors.textSecondary,
                tabBarShowLabel: true,
                tabBarLabelStyle: {
                    fontSize: 10,
                    fontWeight: '600',
                    marginBottom: 4,
                },
                tabBarStyle: {
                    position: 'absolute',
                    bottom: 32,
                    marginLeft: 48,
                    marginRight: 48,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: 'transparent',
                    borderTopWidth: 0,
                    elevation: 0,
                    // Glass border effect
                    paddingBottom: 8,
                    paddingTop: 8,
                    overflow: 'hidden',
                },
                tabBarBackground: () => (
                    <View style={[StyleSheet.absoluteFill, { borderRadius: 32, overflow: 'hidden' }]}>
                        <BlurView
                            style={StyleSheet.absoluteFill}
                            blurType={theme.dark ? "dark" : "light"}
                            blurAmount={20}
                            reducedTransparencyFallbackColor={theme.colors.card}
                        />
                    </View>
                ),
                headerStyle: {
                    backgroundColor: theme.colors.card,
                },
                headerTintColor: theme.colors.text,
                lazy: true,
            }}
        >
            <Tab.Screen
                name="Folders"
                component={FoldersScreen}
                options={{
                    headerShown: false,
                    title: 'Folders',
                    tabBarIcon: ({ color, size, focused }) => (
                        <Feather name="folder" size={24} color={color} style={{ marginBottom: 4 }} />
                    ),
                }}
            />
            <Tab.Screen
                name="Recents"
                component={RecentsScreen}
                options={{
                    title: 'Recents',
                    headerShown: false,
                    tabBarIcon: ({ color, size }) => (
                        <Feather name="clock" size={24} color={color} style={{ marginBottom: 4 }} />
                    ),
                }}
            />
            <Tab.Screen
                name="Settings"
                component={SettingsScreen}
                options={{
                    title: 'Settings',
                    headerShown: false,
                    tabBarIcon: ({ color, size }) => (
                        <Feather name="settings" size={24} color={color} style={{ marginBottom: 4 }} />
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
            console.log('[RootNavigator] URL event received:', url);
            if (DeepLinkService.isVideoUri(url)) {
                console.log('[RootNavigator] Received video URL in main activity, ignoring');
            }
        };
        const unsubscribe = DeepLinkService.addUrlListener(handleUrl);
        return unsubscribe;
    }, []);

    const onNavigationReady = useCallback(() => {
        console.log('[RootNavigator] Navigation ready');
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
                    card: theme.colors.card,
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
        </NavigationContainer>
    );
}
