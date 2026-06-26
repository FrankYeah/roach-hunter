import '@/global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
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
        <Stack.Screen name="index" />
        <Stack.Screen name="order" options={{ presentation: 'card' }} />
        <Stack.Screen name="matching" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="status" />
        <Stack.Screen name="review" />
      </Stack>
    </SafeAreaProvider>
  );
}
