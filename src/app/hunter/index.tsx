import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LevelBadge } from '@/components/level-badge';
import { MosaicTarget } from '@/components/mosaic-target';
import { TARGET_TIERS, VIP_GOLD, levelFromCompleted, nextLevel } from '@/constants/brand';
import { shadowSoft, shadowSos } from '@/constants/shadows';
import { PLATFORM_FEE_RATE, SOS_TASKS, netEarning, tierOf, type SosTask } from '@/data/tasks';
import { safeDistanceMeters } from '@/lib/geo';
import { selectHaptic, successHaptic } from '@/lib/haptics';
import {
  acceptOrder,
  fetchOpenOrders,
  subscribeOpenOrders,
  tierIdFromSize,
  type OpenOrderRow,
} from '@/lib/orders';
import { ensureProfile, fetchProfile, type Profile } from '@/lib/profiles';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAppStore, type LatLng } from '@/store/useAppStore';

/** 派單延遲：未完整認證的獵人，未指定等級的單延後此毫秒數才出現 */
const DISPATCH_DELAY_MS = 3000;

interface PoolItem {
  id: string;
  label: string;
  hint: string;
  mosaic: number;
  distanceM: number | null;
  price: number;
  net: number;
  agoMin: number;
  /** VVIP 急件：金色徽章、優先置頂、無視新手延遲 */
  isVip: boolean;
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function itemFromOrder(o: OpenOrderRow, loc: LatLng | null): PoolItem {
  const tier = TARGET_TIERS.find((t) => t.id === tierIdFromSize(o.target_size))!;
  const price = o.price ?? tier.price;
  // 防呆：任一端座標缺失或為 (0,0) 哨兵值時回 null → 顯示「距離計算中…」
  const distanceM = safeDistanceMeters(loc, {
    latitude: o.location_lat,
    longitude: o.location_lng,
  });
  return {
    id: o.id,
    label: tier.label,
    hint: tier.hint,
    mosaic: tier.mosaic,
    distanceM,
    price,
    net: netEarning(price),
    agoMin: minutesSince(o.created_at),
    isVip: o.is_vip ?? false,
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
    isVip: false,
  };
}

function PoolCard({ item, busy, onAccept }: { item: PoolItem; busy: boolean; onAccept: () => void }) {
  return (
    <View
      className="mb-3 rounded-3xl bg-white p-4"
      style={[shadowSoft, item.isVip ? { borderWidth: 2, borderColor: VIP_GOLD } : null]}
    >
      {/* VVIP 急件徽章（金色）*/}
      {item.isVip && (
        <View className="mb-3 flex-row items-center self-start rounded-full px-3 py-1" style={{ backgroundColor: VIP_GOLD }}>
          <MaterialCommunityIcons name="crown" size={13} color="#FFFFFF" />
          <Text className="ml-1 text-[11px] font-black text-white">VVIP 急件・優先派單</Text>
        </View>
      )}
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
                {item.distanceM == null ? '定位計算中…' : `${item.distanceM} m`}
              </Text>
            </View>
            <Text className="ml-2 text-xs text-mute">· {item.agoMin} 分鐘前</Text>
          </View>
          <Text className="mt-0.5 text-sm text-mute" numberOfLines={1}>
            {item.hint}
          </Text>
          <View className="mt-1 flex-row items-center">
            <Ionicons name="lock-closed" size={10} color="#C4BCB0" />
            <Text className="ml-1 text-[11px] text-mute">接單後解鎖完整地址與進入指引</Text>
          </View>
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

  const [orders, setOrders] = useState<OpenOrderRow[]>([]);
  const [loading, setLoading] = useState(configured);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());

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

  // 進入獵人模式：確保有 profile（名稱仍是預設時，自動同步成「見習獵人」）
  useEffect(() => {
    if (userId) ensureProfile(userId, 'hunter');
  }, [userId]);

  // 每次回到任務池都重抓自己的 profile（等級 / 性別 / 認證可能在設定頁改過）
  useFocusEffect(
    useCallback(() => {
      if (!configured || !userId) return;
      let active = true;
      fetchProfile(userId).then((p) => active && setMyProfile(p));
      return () => {
        active = false;
      };
    }, [configured, userId]),
  );

  // ── 等級 / 認證 ──────────────────────────────
  const myCompleted = myProfile?.completed_tasks ?? 0;
  const myLevel = levelFromCompleted(myCompleted);
  const myGender = myProfile?.gender ?? 'unspecified';
  const fullyVerified = myProfile?.id_verification_status === 'verified';
  const searchRadiusKm = myProfile?.search_radius_km ?? 2; // 拖鞋仙人可自訂，其餘預設 2km
  const next = nextLevel(myCompleted);
  const toNext = next ? Math.max(0, next.minCompleted - myCompleted) : 0;
  const levelProgress = next
    ? Math.min(100, Math.round(((myCompleted - myLevel.minCompleted) / (next.minCompleted - myLevel.minCompleted)) * 100))
    : 100;

  // ── 派單過濾：符合自己等級 + 發案者性別要求 ─────
  const eligible = useMemo(
    () =>
      orders.filter((o) => {
        if ((o.min_completed ?? 0) > myCompleted) return false; // 等級不足
        const pref = o.gender_pref ?? 'any';
        if (pref !== 'any' && pref !== myGender) return false; // 性別不符
        // 接單半徑：距離算得出來且超過半徑才排除（算不出來時不過濾，避免誤殺）
        const d = safeDistanceMeters(userLocation, {
          latitude: o.location_lat,
          longitude: o.location_lng,
        });
        if (d != null && d > searchRadiusKm * 1000) return false;
        return true;
      }),
    [orders, myCompleted, myGender, userLocation, searchRadiusKm],
  );

  // ── 優先派單：未完整認證者，未指定等級的單延遲 3 秒才顯示 ──
  //    例外：VVIP 急件（is_vip）無視此延遲，對所有獵人立即現身、秒搶。
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    eligible.forEach((o) => {
      const delayed = !fullyVerified && (o.min_completed ?? 0) === 0 && !o.is_vip;
      if (delayed) {
        timers.push(
          setTimeout(
            () => setRevealed((p) => (p.has(o.id) ? p : new Set(p).add(o.id))),
            DISPATCH_DELAY_MS,
          ),
        );
      } else {
        setRevealed((p) => (p.has(o.id) ? p : new Set(p).add(o.id)));
      }
    });
    return () => timers.forEach(clearTimeout);
  }, [eligible, fullyVerified]);

  const visibleOrders = eligible.filter((o) => revealed.has(o.id));
  const pendingCount = eligible.length - visibleOrders.length;

  const backToRequester = () => {
    selectHaptic();
    toggleRole();
    router.replace('/');
  };

  const acceptReal = async (order: OpenOrderRow) => {
    if (acceptingId) return;
    setAcceptingId(order.id);
    const { ok, error } = await acceptOrder(order.id, userId ?? '', userLocation);
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
    // 接單成功才解鎖隱私：先帶非敏感的訂單列過去，task 頁再用 fetchOrderPrivate 取精確地址
    setAcceptedOrder({ ...order, status: 'matched', hunter_id: userId ?? null });
    router.push('/hunter/task');
  };

  const acceptMock = (task: SosTask) => {
    successHaptic();
    acceptTask(task.id);
    router.push('/hunter/task');
  };

  const items: PoolItem[] = (
    configured ? visibleOrders.map((o) => itemFromOrder(o, userLocation)) : SOS_TASKS.map(itemFromTask)
  ).sort((a, b) => Number(b.isVip) - Number(a.isVip)); // VVIP 急件優先置頂（穩定排序保留時間序）

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
          <Text className="mt-0.5 text-xs text-mute">附近有 {items.length} 筆呼救等你出動・{myLevel.name}</Text>
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
        {/* 等級面板 */}
        {configured && (
          <View className="mb-4 rounded-3xl bg-white p-4" style={shadowSoft}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <LevelBadge level={myLevel} size="md" />
                <Text className="ml-2 text-xs text-mute">已完成 {myCompleted} 趟</Text>
              </View>
              {fullyVerified ? (
                <View className="flex-row items-center rounded-full bg-silver-light px-2.5 py-1">
                  <MaterialCommunityIcons name="shield-check" size={12} color="#969DA9" />
                  <Text className="ml-1 text-[11px] font-bold text-silver-dark">完整認證・優先派單</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => router.push('/hunter/profile')}
                  accessibilityRole="button"
                  accessibilityLabel="前往完成認證"
                  hitSlop={8}
                >
                  <Text className="text-[11px] font-bold text-sos">完成認證享優先 →</Text>
                </Pressable>
              )}
            </View>

            {next ? (
              <>
                <View className="mt-3 h-2 overflow-hidden rounded-full bg-wood-100">
                  <View className="h-2 rounded-full bg-silver" style={{ width: `${levelProgress}%` }} />
                </View>
                <Text className="mt-1.5 text-[11px] text-mute">
                  距離「{next.name}」還差 <Text className="font-bold text-ink">{toNext}</Text> 趟任務
                </Text>
              </>
            ) : (
              <View className="mt-3 flex-row items-center">
                <MaterialCommunityIcons name="crown" size={14} color="#969DA9" />
                <Text className="ml-1 text-[11px] font-bold text-silver-dark">已達最高等級・{myLevel.name}</Text>
              </View>
            )}
          </View>
        )}

        {/* 未完整認證：被延後的任務提示 */}
        {configured && !fullyVerified && pendingCount > 0 && (
          <View className="mb-3 flex-row items-center rounded-2xl bg-wood-50 px-3 py-2.5">
            <Ionicons name="time-outline" size={14} color="#9A763C" />
            <Text className="ml-1.5 flex-1 text-[11px] text-wood-600">
              有 {pendingCount} 筆新任務優先開放給完整認證的獵人，{DISPATCH_DELAY_MS / 1000} 秒後才對你顯示
            </Text>
          </View>
        )}

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
