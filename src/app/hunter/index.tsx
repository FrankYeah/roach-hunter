import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MosaicTarget } from '@/components/mosaic-target';
import { TARGET_TIERS } from '@/constants/brand';
import { shadowSoft, shadowSos } from '@/constants/shadows';
import { PLATFORM_FEE_RATE, SOS_TASKS, netEarning, tierOf, type SosTask } from '@/data/tasks';
import { distanceMeters } from '@/lib/geo';
import { selectHaptic, successHaptic } from '@/lib/haptics';
import {
  acceptOrder,
  fetchOpenOrders,
  subscribeOpenOrders,
  tierIdFromSize,
  type OrderRow,
} from '@/lib/orders';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAppStore, type LatLng } from '@/store/useAppStore';

interface PoolItem {
  id: string;
  label: string;
  hint: string;
  mosaic: number;
  distanceM: number | null;
  price: number;
  net: number;
  agoMin: number;
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function itemFromOrder(o: OrderRow, loc: LatLng | null): PoolItem {
  const tier = TARGET_TIERS.find((t) => t.id === tierIdFromSize(o.target_size))!;
  const price = o.price ?? tier.price;
  const distanceM =
    loc && o.location_lat != null && o.location_lng != null
      ? distanceMeters(loc, { latitude: o.location_lat, longitude: o.location_lng })
      : null;
  return {
    id: o.id,
    label: tier.label,
    hint: tier.hint,
    mosaic: tier.mosaic,
    distanceM,
    price,
    net: netEarning(price),
    agoMin: minutesSince(o.created_at),
  };
}

function itemFromTask(t: SosTask): PoolItem {
  const tier = tierOf(t);
  return {
    id: t.id,
    label: tier.label,
    hint: tier.hint,
    mosaic: tier.mosaic,
    distanceM: t.distanceM,
    price: tier.price,
    net: netEarning(tier.price),
    agoMin: t.postedAgoMin,
  };
}

function PoolCard({ item, busy, onAccept }: { item: PoolItem; busy: boolean; onAccept: () => void }) {
  return (
    <View className="mb-3 rounded-3xl bg-white p-4" style={shadowSoft}>
      <View className="flex-row items-center">
        <View className="h-14 w-14 items-center justify-center rounded-2xl bg-cream">
          <MosaicTarget size={28 + item.mosaic * 7} />
        </View>
        <View className="ml-3 flex-1">
          <View className="flex-row items-center">
            <Text className="text-base font-black text-ink">{item.label}</Text>
            <View className="ml-2 flex-row items-center">
              <Ionicons name="navigate" size={12} color="#9A8F80" />
              <Text className="ml-0.5 text-xs text-mute">
                {item.distanceM == null ? '—' : `${item.distanceM} m`}
              </Text>
            </View>
            <Text className="ml-2 text-xs text-mute">· {item.agoMin} 分鐘前</Text>
          </View>
          <Text className="mt-0.5 text-sm text-mute" numberOfLines={1}>
            {item.hint}
          </Text>
        </View>
      </View>

      <View className="my-3 h-px bg-wood-100" />

      <View className="flex-row items-end justify-between">
        <View>
          <Text className="text-[11px] text-mute">
            訂單 ${item.price}・平台抽 {Math.round(PLATFORM_FEE_RATE * 100)}%
          </Text>
          <View className="mt-0.5 flex-row items-end">
            <Text className="text-xs font-semibold text-leaf">淨收益 </Text>
            <Text className="text-2xl font-black text-leaf">${item.net}</Text>
          </View>
        </View>
        <Pressable
          onPress={onAccept}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`接單，${item.label}，淨收益 ${item.net} 元`}
          style={({ pressed }) => [shadowSos, { transform: [{ scale: pressed ? 0.97 : 1 }], opacity: busy ? 0.6 : 1 }]}
        >
          <View className="flex-row items-center rounded-2xl bg-sos px-5 py-2.5">
            <FontAwesome5 name="shoe-prints" size={13} color="#FFFFFF" />
            <Text className="ml-2 text-base font-black text-white">{busy ? '接單中…' : '接單'}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export default function HunterPoolScreen() {
  const configured = isSupabaseConfigured;
  const toggleRole = useAppStore((s) => s.toggleRole);
  const acceptTask = useAppStore((s) => s.acceptTask);
  const setAcceptedOrder = useAppStore((s) => s.setAcceptedOrder);
  const userId = useAppStore((s) => s.userId);
  const userLocation = useAppStore((s) => s.userLocation);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(configured);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await fetchOpenOrders();
    setOrders(data);
    setLoading(false);
  }, []);

  // 即時讀取 searching 訂單：初次抓取 + 訂閱變更（卸載時 unsubscribe）
  useEffect(() => {
    if (!configured) return;
    refresh();
    const unsub = subscribeOpenOrders(refresh);
    return unsub;
  }, [configured, refresh]);

  const backToRequester = () => {
    selectHaptic();
    toggleRole();
    router.replace('/');
  };

  const acceptReal = async (order: OrderRow) => {
    if (acceptingId) return;
    setAcceptingId(order.id);
    const { ok, error } = await acceptOrder(order.id, userId ?? '');
    setAcceptingId(null);
    if (error) {
      Alert.alert('接單失敗', error);
      return;
    }
    if (!ok) {
      Alert.alert('來晚一步', '這張單已經被別的獵人搶走了');
      refresh();
      return;
    }
    successHaptic();
    setAcceptedOrder({ ...order, status: 'matched', hunter_id: userId ?? null });
    router.push('/hunter/task');
  };

  const acceptMock = (task: SosTask) => {
    successHaptic();
    acceptTask(task.id);
    router.push('/hunter/task');
  };

  const items: PoolItem[] = configured
    ? orders.map((o) => itemFromOrder(o, userLocation))
    : SOS_TASKS.map(itemFromTask);

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      {/* 頂部 */}
      <View className="flex-row items-center justify-between px-5 pb-3 pt-1">
        <View>
          <View className="flex-row items-center">
            <Text className="text-2xl font-black text-ink">任務池</Text>
            <View className="ml-2 flex-row items-center rounded-full bg-leaf/15 px-2 py-0.5">
              <View className="mr-1 h-2 w-2 rounded-full bg-leaf" />
              <Text className="text-[11px] font-bold text-leaf">上線中</Text>
            </View>
          </View>
          <Text className="mt-0.5 text-xs text-mute">附近有 {items.length} 筆呼救等你出動・拖鞋見習生</Text>
        </View>
        <View className="flex-row items-center">
          <Pressable
            onPress={() => router.push('/hunter/profile')}
            accessibilityRole="button"
            accessibilityLabel="個人設定與實名認證"
            className="mr-2 h-9 w-9 items-center justify-center rounded-full bg-cream"
            style={shadowSoft}
          >
            <Ionicons name="person-circle-outline" size={20} color="#9A763C" />
          </Pressable>
          <Pressable
            onPress={backToRequester}
            accessibilityRole="button"
            accessibilityLabel="切換為求救者身分"
            className="flex-row items-center rounded-full bg-cream px-3 py-1.5"
            style={shadowSoft}
          >
            <MaterialCommunityIcons name="swap-horizontal" size={16} color="#9A763C" />
            <Text className="ml-1 text-xs font-bold text-ink">求救者</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {configured && loading ? (
          <View className="mt-16 items-center">
            <ActivityIndicator color="#FB6B4B" />
            <Text className="mt-3 text-xs text-mute">載入任務池…</Text>
          </View>
        ) : items.length === 0 ? (
          <View className="mt-16 items-center">
            <View className="opacity-30">
              <MosaicTarget size={48} vibrate={false} />
            </View>
            <Text className="mt-4 text-sm font-bold text-ink">目前沒有呼救</Text>
            <Text className="mt-1 text-xs text-mute">待命中…有人發單會即時出現</Text>
          </View>
        ) : (
          <>
            {items.map((item) => (
              <PoolCard
                key={item.id}
                item={item}
                busy={acceptingId === item.id}
                onAccept={() =>
                  configured
                    ? acceptReal(orders.find((o) => o.id === item.id)!)
                    : acceptMock(SOS_TASKS.find((t) => t.id === item.id)!)
                }
              />
            ))}
            <Text className="mt-2 text-center text-[11px] text-mute">已經到底囉，等更多金主呼救中…</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
