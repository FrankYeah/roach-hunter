import '@/global.css';

import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppStore } from '@/store/useAppStore';

export default function RootLayout() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const segments = useSegments();
  const router = useRouter();

  // 登入 gate：未登入一律導向 /login；登入後若還在 /login 則回首頁
  useEffect(() => {
    const onLogin = segments[0] === 'login';
    if (!isAuthenticated && !onLogin) router.replace('/login');
    else if (isAuthenticated && onLogin) router.replace('/');
  }, [isAuthenticated, segments, router]);

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
