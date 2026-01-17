import { useSettings } from '@/hooks/useSettings';
import RootNavigator from '@/navigation/RootNavigator';
import { FileService } from '@/services/FileService';
import { useTheme } from '@/hooks/useTheme';
import { ErrorBoundary } from 'ErrorBoundary';
import React, { useEffect, useState, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SystemBars } from 'react-native-edge-to-edge';
import { withStallion } from 'react-native-stallion';
import { SplashScreen } from '@/components/SplashScreen';

const MINIMUM_SPLASH_DURATION = 1000;

function App() {
  const [appReady, setAppReady] = useState(false);
  const [navReady, setNavReady] = useState(false);
  const [minimumTimeElapsed, setMinimumTimeElapsed] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const theme = useTheme();
  useSettings();

  useEffect(() => {
    SystemBars.setStyle(theme.dark ? 'light' : 'dark')
  }, [theme])

  useEffect(() => {
    const timer = setTimeout(() => {
      setMinimumTimeElapsed(true);
    }, MINIMUM_SPLASH_DURATION);

    return () => clearTimeout(timer);
  }, []);

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

  // App is fully ready when all conditions are met
  const isFullyReady = appReady && navReady;

  // Hide splash only when fully ready AND minimum time has elapsed
  const shouldHideSplash = isFullyReady && minimumTimeElapsed;

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorBoundary
          onError={(error, errorInfo) => console.log('App Error:', error, errorInfo)}
          onReset={() => console.log('App Reset')}
        >
          <RootNavigator onReady={() => setNavReady(true)} />
        </ErrorBoundary>

        {showSplash && (
          <SplashScreen
            visible={!shouldHideSplash}
            onAnimationEnd={() => setShowSplash(false)}
          />
        )}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export default withStallion(App);
