import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { shadowSoft } from '@/constants/shadows';
import { fetchUnreadCount, subscribeNotifications } from '@/lib/notifications';
import { useAppStore } from '@/store/useAppStore';

/**
 * 通知鈴鐺 + 未讀紅點。放在首頁 / 任務池頁首。
 * 進畫面（含從通知中心返回）時重抓未讀數，並訂閱新通知即時 +1。
 */
export function NotificationBell() {
  const userId = useAppStore((s) => s.userId);
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      fetchUnreadCount(userId).then((n) => active && setUnread(n));
      const unsub = subscribeNotifications(userId, () => setUnread((x) => x + 1));
      return () => {
        active = false;
        unsub();
      };
    }, [userId]),
  );

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/notifications' } as unknown as Href)}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `通知，${unread} 則未讀` : '通知'}
      className="h-9 w-9 items-center justify-center rounded-full bg-cream"
      style={shadowSoft}
    >
      <Ionicons name="notifications-outline" size={19} color="#9A763C" />
      {unread > 0 && (
        <View className="absolute -right-0.5 -top-0.5 min-w-[16px] items-center justify-center rounded-full bg-sos px-1">
          <Text className="text-[10px] font-black text-white">{unread > 99 ? '99+' : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}
