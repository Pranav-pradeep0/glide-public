import { useSettings } from '@/hooks/useSettings';
import RootNavigator from '@/navigation/RootNavigator';
import { FileService } from '@/services/FileService';
import { useTheme } from '@/hooks/useTheme';
import { ErrorBoundary } from 'ErrorBoundary';
import React, { useEffect, useState } from 'react';
import {
  StatusBar,
  View,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SystemBars } from 'react-native-edge-to-edge';
import { withStallion } from 'react-native-stallion';

function App() {
  const [appReady, setAppReady] = useState(false);
  const [navReady, setNavReady] = useState(false);
  const theme = useTheme();
  useSettings();

  useEffect(() => {
    SystemBars.setStyle(theme.dark ? 'light' : 'dark')
  }, [theme])


  useEffect(() => {
    initializeApp();
  }, []);

  async function initializeApp() {
    try {
      const subtitleCacheDir = FileService.getSubtitleCacheDir();
      await FileService.ensureDir(subtitleCacheDir);
      setAppReady(true);
      console.log('App initialized successfully');
    } catch (error) {
      console.error('Initialization error:', error);
      setAppReady(true);
    }
  }

  const isFullyReady = appReady && navReady;

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorBoundary
          onError={(error, errorInfo) => console.log('App Error:', error, errorInfo)}
          onReset={() => console.log('App Reset')}
        >
          <RootNavigator onReady={() => setNavReady(true)} />
        </ErrorBoundary>

        {!isFullyReady && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: theme.colors.background,
              zIndex: 9999,
            }}
          >
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        )}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export default withStallion(App);