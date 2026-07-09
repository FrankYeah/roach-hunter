import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { shadowSoft } from '@/constants/shadows';
import {
  fetchNotifications,
  markAllNotificationsRead,
  type AppNotification,
} from '@/lib/notifications';
import { useAppStore } from '@/store/useAppStore';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

export default function NotificationsScreen() {
  const userId = useAppStore((s) => s.userId);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let active = true;
    fetchNotifications(userId).then((list) => {
      if (!active) return;
      setItems(list);
      setLoading(false);
      // 進來即全部標為已讀（紅點歸零）；本地也更新外觀
      markAllNotificationsRead(userId);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const open = (n: AppNotification) => {
    if (n.route && n.route.startsWith('/')) router.push(n.route as Href);
  };

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      <View className="flex-row items-center px-4 pb-2 pt-1">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          className="h-10 w-10 items-center justify-center rounded-full bg-cream"
        >
          <Ionicons name="chevron-back" size={22} color="#2A2521" />
        </Pressable>
        <Text className="ml-3 text-xl font-black text-ink">通知中心</Text>
      </View>

      {loading ? (
        <View className="mt-20 items-center">
          <ActivityIndicator color="#FB6B4B" />
        </View>
      ) : items.length === 0 ? (
        <View className="mt-24 items-center px-10">
          <Ionicons name="notifications-off-outline" size={40} color="#C4BCB0" />
          <Text className="mt-3 text-sm font-bold text-ink">目前沒有通知</Text>
          <Text className="mt-1 text-center text-xs text-mute">
            有新任務、獵人動態或新訊息時，會出現在這裡
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-5"
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {items.map((n) => (
            <Pressable
              key={n.id}
              onPress={() => open(n)}
              disabled={!n.route}
              accessibilityRole={n.route ? 'button' : 'text'}
              accessibilityLabel={n.title}
              className="mb-2.5 flex-row items-start rounded-2xl bg-white px-4 py-3"
              style={({ pressed }) => [shadowSoft, { transform: [{ scale: pressed ? 0.99 : 1 }] }]}
            >
              {/* 未讀圓點 */}
              <View className="mt-1.5 w-2">
                {!n.read && <View className="h-2 w-2 rounded-full bg-sos" />}
              </View>
              <View className="ml-2 flex-1">
                <Text className="text-sm font-bold text-ink">{n.title}</Text>
                {n.body ? <Text className="mt-0.5 text-xs text-mute">{n.body}</Text> : null}
                <Text className="mt-1 text-[11px] text-mute">{timeAgo(n.created_at)}</Text>
              </View>
              {n.route ? <Ionicons name="chevron-forward" size={14} color="#C4BCB0" /> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
