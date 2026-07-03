import '@/global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ensureProfile } from '@/lib/profiles';
import { usePushNotifications } from '@/lib/push';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

export default function RootLayout() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const authReady = useAppStore((s) => s.authReady);
  const applySession = useAppStore((s) => s.applySession);
  const setAuthReady = useAppStore((s) => s.setAuthReady);
  const userId = useAppStore((s) => s.userId);

  // 登入後註冊推播 token + 監聽「點擊推播 → 導頁」；登出 / 未登入時無事
  usePushNotifications(userId);

  // 冷啟動：還原 Supabase session（未設定 Supabase 則直接就緒，走 mock）
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthReady(true);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      applySession(data.session);
      const uid = data.session?.user?.id ?? null;
      if (uid) ensureProfile(uid, useAppStore.getState().role); // 登入後確保有預設 profile
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
      const uid = session?.user?.id ?? null;
      if (uid) ensureProfile(uid, useAppStore.getState().role);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [applySession, setAuthReady]);

  // 還在還原 session 時顯示簡單 splash，避免閃一下登入頁
  if (!authReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }}>
        <ActivityIndicator color="#FB6B4B" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {/* 宣告式登入守衛：未登入只開放 /login，登入後開放其餘畫面 */}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#FFFFFF' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="index" />
          <Stack.Screen name="order" options={{ presentation: 'card' }} />
          <Stack.Screen name="matching" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="status" />
          <Stack.Screen name="review" />
          <Stack.Screen name="history" />
          <Stack.Screen name="client/profile" />
          <Stack.Screen name="hunter/index" />
          <Stack.Screen name="hunter/task" />
          <Stack.Screen name="hunter/profile" />
        </Stack.Protected>
        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="login" options={{ gestureEnabled: false, animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}
