import '@/global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppStore } from '@/store/useAppStore';

export default function RootLayout() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {/* 宣告式登入守衛：未登入只開放 /login，登入後開放其餘畫面。
          由 expo-router 在導覽器就緒後自動切換，避免命令式導航的時序錯誤。 */}
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
