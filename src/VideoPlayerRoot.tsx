import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ErrorBoundary } from 'ErrorBoundary';
import VideoPlayerScreen from '@/screens/VideoPlayerScreen';
import PlayerDetailScreen from '@/screens/PlayerDetailScreen';
import { useTheme } from '@/hooks/useTheme';
import { useSettings } from '@/hooks/useSettings';
import { DeepLinkService } from '@/services/DeepLinkService';
import { ContentDetector } from '@/services/ContentDetector';
import { NavigationService } from '@/services/NavigationService';
import { SystemBars } from 'react-native-edge-to-edge';

const Stack = createNativeStackNavigator();

type Props = {
    videoPath?: string;
    videoName?: string;
    contentUri?: string;
    playMode?: string;
    albumName?: string;
    imdbId?: string;
    cleanTitle?: string;
    hapticCues?: any;
    apiSubtitles?: any;
};

export default function VideoPlayerRoot(props: Props) {
    const { videoPath, videoName: initialVideoName, playMode } = props;
    const theme = useTheme();
    useSettings(); // Initialize settings

    const [ready, setReady] = useState(false);
    const [initialState, setInitialState] = useState<{
        routeName: string;
        params: any;
    } | null>(null);

    useEffect(() => {
        const prepare = async () => {
            if (videoPath) {
                // Determine if this is an internal launch or external open
                // Internal launches from VideoPlayerModule will have playMode
                const isInternal = !!playMode;

                let resolvedPath = videoPath;
                let videoName = initialVideoName || DeepLinkService.getVideoNameFromUri(videoPath);

                // For external opens (no playMode), we might need to resolve URI and classify
                if (!isInternal) {
                    resolvedPath = await DeepLinkService.resolveToFilePath(videoPath);
                    const isStream = NavigationService.isNetworkStream(resolvedPath);

                    let targetRoute = 'VideoPlayer';
                    if (!isStream) {
                        const classification = ContentDetector.classifySync(resolvedPath);
                        if (classification.contentType === 'movie' || classification.contentType === 'series') {
                            targetRoute = 'PlayerDetail';
                        }
                    }

                    setInitialState({
                        routeName: targetRoute,
                        params: {
                            ...props,
                            videoPath: resolvedPath,
                            videoName: videoName,
                            isExternalOpen: true,
                        }
                    });
                } else {
                    // Internal launch - always go to VideoPlayer
                    setInitialState({
                        routeName: 'VideoPlayer',
                        params: {
                            ...props,
                            isExternalOpen: false,
                        }
                    });
                }
            }
            setReady(true);
        };
        prepare();
    }, [videoPath, initialVideoName, playMode]);

    // Set dark mode for system bars since player is usually dark
    useEffect(() => {
        SystemBars.setStyle('light');
        SystemBars.setHidden(false);
        return () => {
            SystemBars.setStyle('auto');
        };
    }, []);

    if (!ready || !initialState) {
        return (
            <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
        );
    }

    return (
        <SafeAreaProvider style={{ flex: 1, backgroundColor: '#000' }}>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
                <ErrorBoundary onError={console.error}>
                    <NavigationContainer theme={DarkTheme}>
                        <Stack.Navigator
                            initialRouteName={initialState.routeName}
                            screenOptions={{ headerShown: false }}
                        >
                            <Stack.Screen
                                name="PlayerDetail"
                                component={PlayerDetailScreen}
                                initialParams={initialState.params}
                            />
                            <Stack.Screen
                                name="VideoPlayer"
                                // @ts-ignore
                                component={VideoPlayerScreen}
                                initialParams={initialState.params}
                            />
                        </Stack.Navigator>
                    </NavigationContainer>
                </ErrorBoundary>
            </GestureHandlerRootView>
        </SafeAreaProvider>
    );
}
