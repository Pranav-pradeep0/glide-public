import { useSettings } from '@/hooks/useSettings';
import RootNavigator from '@/navigation/RootNavigator';
import { FileService } from '@/services/FileService';
import { useTheme } from '@/hooks/useTheme';
import { useVideoIndexStore } from '@/store/videoIndexStore';
import { ErrorBoundary } from 'ErrorBoundary';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SystemBars } from 'react-native-edge-to-edge';
import { withStallion } from 'react-native-stallion';
import { NativeModules } from 'react-native';

function App() {
  const [appReady, setAppReady] = useState(false);
  const [navReady, setNavReady] = useState(false);
  const theme = useTheme();

  const { initialize } = useVideoIndexStore();

  useSettings();

  useEffect(() => {
    SystemBars.setStyle(theme.dark ? 'light' : 'dark')
  }, [theme])

  useEffect(() => {
    initializeApp();
  }, []);

  const startTime = useRef(Date.now());

  useEffect(() => {
    if (appReady && navReady) {
      const elapsed = Date.now() - startTime.current;
      const minDuration = 1000;
      const remaining = Math.max(0, minDuration - elapsed);

      const timer = setTimeout(() => {
        NativeModules.SplashModule?.hide();
      }, remaining);
      return () => clearTimeout(timer);
    }
  }, [appReady, navReady]);

  async function initializeApp() {
    try {
      const subtitleCacheDir = FileService.getSubtitleCacheDir();
      await FileService.ensureDir(subtitleCacheDir);

      initialize();

      setAppReady(true);
      console.log('App initialized successfully');
    } catch (error) {
      console.error('Initialization error:', error);
      setAppReady(true);
    }
  }

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorBoundary
          onError={(error, errorInfo) => console.log('App Error:', error, errorInfo)}
          onReset={() => console.log('App Reset')}
        >
          <RootNavigator onReady={() => setNavReady(true)} />
        </ErrorBoundary>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export default withStallion(App);
