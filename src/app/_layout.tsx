import '@/global.css';

import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppStore } from '@/store/useAppStore';

export default function RootLayout() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const segments = useSegments();
  const router = useRouter();
  // 根導覽器掛載後才會有 key；用它避免「在 Root Layout 掛載前就導航」
  const rootNav = useRootNavigationState();
  const navReady = !!rootNav?.key;

  // 登入 gate：未登入一律導向 /login；登入後若還在 /login 則回首頁
  useEffect(() => {
    if (!navReady) return; // 等導覽器就緒
    const onLogin = segments[0] === 'login';
    if (!isAuthenticated && !onLogin) router.replace('/login');
    else if (isAuthenticated && onLogin) router.replace('/');
  }, [navReady, isAuthenticated, segments, router]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#FFFFFF' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="login" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="index" />
        <Stack.Screen name="order" options={{ presentation: 'card' }} />
        <Stack.Screen name="matching" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="status" />
        <Stack.Screen name="review" />
      </Stack>
    </SafeAreaProvider>
  );
}
