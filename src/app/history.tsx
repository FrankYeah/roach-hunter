import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ESCAPE_FEE, TARGET_TIERS } from '@/constants/brand';
import { shadowSoft } from '@/constants/shadows';
import { netEarning } from '@/data/tasks';
import { fetchMyOrders, tierIdFromSize, type OrderRow, type OrderStatusDb } from '@/lib/orders';
import { fetchProfile, fetchProfilesMap, type Profile } from '@/lib/profiles';
import { useAppStore } from '@/store/useAppStore';

/** 訂單狀態 → 中文標籤 + 配色（淺木質調）*/
const STATUS_META: Record<OrderStatusDb, { label: string; badge: string; text: string }> = {
  searching: { label: '媒合中', badge: 'bg-sos/10', text: 'text-sos' },
  matched: { label: '進行中', badge: 'bg-sos/10', text: 'text-sos' },
  completed: { label: '已完成', badge: 'bg-leaf/15', text: 'text-leaf' },
  escaped: { label: '目標逃逸', badge: 'bg-wood-100', text: 'text-wood-600' },
  cancelled: { label: '已取消', badge: 'bg-wood-50', text: 'text-mute' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}`;
}

function sizeLabel(size: OrderRow['target_size']): string {
  return TARGET_TIERS.find((t) => t.id === tierIdFromSize(size))?.label ?? size;
}

export default function HistoryScreen() {
  const userId = useAppStore((s) => s.userId);

  const [me, setMe] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [names, setNames] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      const [p, os] = await Promise.all([fetchProfile(userId), fetchMyOrders(userId)]);
      if (!active) return;
      setMe(p);
      setOrders(os);
      // 撈出每筆訂單「對方」的名字（我是 client → 對方是 hunter，反之亦然）
      const map = await fetchProfilesMap(os.map((o) => (o.client_id === userId ? o.hunter_id : o.client_id)));
      if (active) {
        setNames(map);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  // 錢包異動明細：目前唯一會動到儲值金的事件就是「撲空結算」，故由 escaped 訂單推導。
  const walletEntries = orders
    .filter((o) => o.status === 'escaped')
    .map((o) => {
      const asClient = o.client_id === userId;
      const amount = asClient ? Math.max((o.price ?? 0) - ESCAPE_FEE, 0) : ESCAPE_FEE;
      return {
        id: o.id,
        label: asClient ? '撲空退款入帳' : '撲空車馬費入帳',
        sub: asClient ? '目標逃逸・差額退回儲值金' : '目標逃逸・固定車馬費',
        amount,
        date: o.created_at,
      };
    })
    .filter((e) => e.amount > 0);

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      {/* 標題列 */}
      <View className="flex-row items-center px-4 pb-2 pt-1">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          className="h-10 w-10 items-center justify-center rounded-full bg-cream"
        >
          <Ionicons name="chevron-back" size={22} color="#2A2521" />
        </Pressable>
        <Text className="ml-3 text-xl font-black text-ink">歷史紀錄與錢包</Text>
      </View>

      {loading ? (
        <View className="mt-20 items-center">
          <ActivityIndicator color="#FB6B4B" />
          <Text className="mt-3 text-xs text-mute">載入歷史紀錄…</Text>
        </View>
      ) : (
        <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {/* 錢包餘額 */}
          <View className="mt-2 flex-row items-center rounded-3xl bg-ink p-4" style={shadowSoft}>
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <MaterialCommunityIcons name="wallet-outline" size={24} color="#FFFFFF" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-xs text-silver">儲值金錢包</Text>
              <Text className="text-2xl font-black text-white">${me?.wallet_balance ?? 0}</Text>
            </View>
            <Text className="text-[11px] text-silver">可折抵未來訂單</Text>
          </View>

          {/* 錢包異動明細 */}
          <Text className="mb-2 mt-6 text-base font-black text-ink">錢包異動明細</Text>
          {walletEntries.length === 0 ? (
            <View className="rounded-2xl border border-wood-100 bg-white px-4 py-5" style={shadowSoft}>
              <Text className="text-center text-xs text-mute">目前沒有任何儲值金異動</Text>
            </View>
          ) : (
            walletEntries.map((e) => (
              <View key={e.id} className="mb-2.5 flex-row items-center rounded-2xl bg-white px-4 py-3" style={shadowSoft}>
                <View className="h-10 w-10 items-center justify-center rounded-full bg-leaf/15">
                  <MaterialCommunityIcons name="cash-plus" size={20} color="#7FB069" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-sm font-bold text-ink">{e.label}</Text>
                  <Text className="text-[11px] text-mute">
                    {e.sub}・{formatDate(e.date)}
                  </Text>
                </View>
                <Text className="text-base font-black text-leaf">+${e.amount}</Text>
              </View>
            ))
          )}

          {/* 歷史訂單 */}
          <Text className="mb-2 mt-7 text-base font-black text-ink">歷史訂單</Text>
          {orders.length === 0 ? (
            <View className="mt-4 items-center rounded-3xl bg-white px-4 py-10" style={shadowSoft}>
              <MaterialCommunityIcons name="clipboard-text-outline" size={36} color="#C4BCB0" />
              <Text className="mt-3 text-sm font-bold text-ink">還沒有任何訂單</Text>
              <Text className="mt-1 text-xs text-mute">呼救或接單後，紀錄會出現在這裡</Text>
            </View>
          ) : (
            orders.map((o) => {
              const asClient = o.client_id === userId;
              const meta = STATUS_META[o.status];
              const cpId = asClient ? o.hunter_id : o.client_id;
              const cpName = cpId ? names[cpId]?.display_name ?? '對方' : asClient ? '尚未媒合' : '求救者';
              const price = o.price ?? 0;
              const spent = o.status === 'escaped' ? ESCAPE_FEE : o.status === 'cancelled' ? 0 : price;
              const earned = o.status === 'escaped' ? ESCAPE_FEE : o.status === 'cancelled' ? 0 : netEarning(price);
              return (
                <View key={o.id} className="mb-3 rounded-3xl bg-white p-4" style={shadowSoft}>
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center">
                      {/* 身分標籤：求救 / 出動 */}
                      <View className={`rounded-full px-2 py-0.5 ${asClient ? 'bg-sos/10' : 'bg-leaf/15'}`}>
                        <Text className={`text-[11px] font-black ${asClient ? 'text-sos' : 'text-leaf'}`}>
                          {asClient ? '求救' : '出動'}
                        </Text>
                      </View>
                      <Text className="ml-2 text-[11px] text-mute">{formatDate(o.created_at)}</Text>
                      {o.is_vip && (
                        <MaterialCommunityIcons name="crown" size={13} color="#E6B422" style={{ marginLeft: 4 }} />
                      )}
                    </View>
                    {/* 狀態徽章 */}
                    <View className={`rounded-full px-2.5 py-1 ${meta.badge}`}>
                      <Text className={`text-[11px] font-bold ${meta.text}`}>{meta.label}</Text>
                    </View>
                  </View>

                  <View className="mt-3 flex-row items-end justify-between">
                    <View className="flex-1">
                      <Text className="text-sm font-black text-ink">
                        {sizeLabel(o.target_size)}的目標
                      </Text>
                      <View className="mt-0.5 flex-row items-center">
                        <Ionicons name={asClient ? 'walk' : 'home'} size={11} color="#9A8F80" />
                        <Text className="ml-1 text-xs text-mute">
                          {asClient ? '獵人' : '求救者'}：{cpName}
                        </Text>
                      </View>
                    </View>
                    <View className="items-end">
                      <Text className={`text-lg font-black ${asClient ? 'text-ink' : 'text-leaf'}`}>
                        {asClient ? `-$${spent}` : `+$${earned}`}
                      </Text>
                      <Text className="text-[10px] text-mute">{asClient ? '花費' : '淨賺取'}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
