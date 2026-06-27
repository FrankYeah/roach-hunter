import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LevelBadge } from '@/components/level-badge';
import { levelFromCompleted } from '@/constants/brand';
import { shadowSoft } from '@/constants/shadows';
import { NEARBY_HUNTERS } from '@/data/hunters';
import { etaMinFromMeters, safeDistanceMeters } from '@/lib/geo';
import { fetchOrder, subscribeOrder, type OrderRow } from '@/lib/orders';
import { fetchProfile, type Profile } from '@/lib/profiles';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

const STEPS = ['媒合成功', '獵人出發', '抵達現場', '任務完成'];
const CURRENT_STEP = 1;

const QUICK_REPLIES = ['門口在鞋櫃旁 🙏', '牠在廚房水槽！', '我先去房間躲一下', '拜託快一點 😭'];

export default function StatusScreen() {
  const configured = isSupabaseConfigured;
  const matchedHunterId = useAppStore((s) => s.matchedHunterId);
  const orderId = useAppStore((s) => s.orderId);
  const completeOrder = useAppStore((s) => s.completeOrder);
  const resetOrder = useAppStore((s) => s.resetOrder);

  // mock 後備（未設定 Supabase 時沿用）
  const mockHunter = NEARBY_HUNTERS.find((h) => h.id === matchedHunterId) ?? NEARBY_HUNTERS[0];

  // 真實模式：讀取獵人 profile + 訂單列（含獵人接單座標）
  const [hunterProfile, setHunterProfile] = useState<Profile | null>(null);
  const [orderRow, setOrderRow] = useState<OrderRow | null>(null);

  useEffect(() => {
    if (!configured || !matchedHunterId) return;
    let active = true;
    fetchProfile(matchedHunterId).then((p) => active && setHunterProfile(p));
    return () => {
      active = false;
    };
  }, [configured, matchedHunterId]);

  useEffect(() => {
    if (!configured || !orderId) return;
    let active = true;
    // 先抓一次，再訂閱更新（獵人座標可能在跳轉後才寫入 → Realtime 補上）
    fetchOrder(orderId).then((o) => active && o && setOrderRow(o));
    const unsub = subscribeOrder(orderId, (row) => setOrderRow(row));
    return () => {
      active = false;
      unsub();
    };
  }, [configured, orderId]);

  // 真實距離 = 求救者家 → 獵人接單位置（純從訂單列取，套防呆）
  const distanceM = configured
    ? safeDistanceMeters(
        { latitude: orderRow?.location_lat, longitude: orderRow?.location_lng },
        { latitude: orderRow?.hunter_lat, longitude: orderRow?.hunter_lng },
      )
    : mockHunter.distanceM;
  const etaMin = configured
    ? distanceM != null
      ? etaMinFromMeters(distanceM)
      : null
    : mockHunter.etaMin;

  const name = configured ? hunterProfile?.display_name ?? '媒合中的獵人' : mockHunter.name;
  const rating = configured ? hunterProfile?.rating ?? null : mockHunter.rating;
  const completed = configured ? hunterProfile?.completed_tasks ?? 0 : mockHunter.kills;
  const level = levelFromCompleted(completed);
  const avatarColor = configured ? '#C9A66B' : mockHunter.avatarColor;
  const avatarUrl = configured ? hunterProfile?.avatar_url ?? null : null;
  const blurb = configured ? '準備好拖鞋，正在趕來' : mockHunter.blurb;

  // 對話框只在「媒合成功（matched）」後出現；searching/escaped 階段不顯示。
  // mock 模式（未設定 Supabase）沒有真實 status，直接視為已媒合。
  const orderStatusDb = orderRow?.status ?? null;
  const showChat = !configured || orderStatusDb === 'matched';
  const isEscaped = orderStatusDb === 'escaped';

  const goHome = () => {
    resetOrder();
    router.replace('/');
  };

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
        <View className="ml-3">
          <Text className="text-xl font-black text-ink">獵人出發囉！</Text>
          <Text className="text-xs text-mute">穿著夾腳拖，正在趕來的路上</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        {/* 撲空通知（目標逃逸）*/}
        {isEscaped && (
          <View className="mt-2 flex-row items-start rounded-3xl bg-wood-50 p-4" style={shadowSoft}>
            <MaterialCommunityIcons name="run-fast" size={20} color="#9A763C" />
            <View className="ml-2 flex-1">
              <Text className="text-sm font-black text-ink">目標已逃逸・任務撲空</Text>
              <Text className="mt-0.5 text-xs leading-5 text-wood-600">
                獵人僅收取車馬費，你預付金額的差額已自動退成
                <Text className="font-bold">儲值金</Text>，存進你的錢包可折抵下次。
              </Text>
            </View>
          </View>
        )}

        {/* ETA 大字 */}
        <View className="mt-2 items-center rounded-[28px] bg-sos/10 py-6" style={shadowSoft}>
          <Text className="text-xs font-semibold text-sos">預計抵達時間</Text>
          {etaMin == null ? (
            <Text className="mt-2 text-2xl font-black text-sos">定位計算中…</Text>
          ) : (
            <View className="mt-1 flex-row items-end">
              <Text className="text-6xl font-black text-sos">{etaMin}</Text>
              <Text className="mb-2 ml-1 text-xl font-bold text-sos">分鐘</Text>
            </View>
          )}
          <Text className="mt-1 text-xs text-mute">
            {distanceM == null ? '位置同步中，稍候顯示距離' : `距離你家約 ${distanceM} 公尺`}
          </Text>
        </View>

        {/* 進度條 */}
        <View className="mt-5 flex-row items-center justify-between px-1">
          {STEPS.map((label, i) => {
            const done = i <= CURRENT_STEP;
            return (
              <View key={label} className="flex-1 items-center">
                <View className="w-full flex-row items-center">
                  <View className={`h-1 flex-1 ${i === 0 ? 'opacity-0' : done ? 'bg-sos' : 'bg-wood-100'}`} />
                  <View
                    className={`h-6 w-6 items-center justify-center rounded-full ${
                      done ? 'bg-sos' : 'bg-wood-100'
                    }`}
                  >
                    {done ? (
                      <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                    ) : (
                      <View className="h-2 w-2 rounded-full bg-white" />
                    )}
                  </View>
                  <View
                    className={`h-1 flex-1 ${
                      i === STEPS.length - 1 ? 'opacity-0' : i < CURRENT_STEP ? 'bg-sos' : 'bg-wood-100'
                    }`}
                  />
                </View>
                <Text className={`mt-1.5 text-[10px] ${done ? 'font-bold text-ink' : 'text-mute'}`}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>

        {/* 獵人卡片 */}
        <View className="mt-6 flex-row items-center rounded-3xl bg-white p-4" style={shadowSoft}>
          <View
            className="h-16 w-16 items-center justify-center overflow-hidden rounded-full border-[3px] border-white"
            style={{ backgroundColor: avatarColor, ...shadowSoft }}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={{ width: 58, height: 58 }} />
            ) : (
              <FontAwesome5 name="shoe-prints" size={24} color="#FFFFFF" />
            )}
          </View>
          <View className="ml-4 flex-1">
            <View className="flex-row items-center">
              <Text className="text-lg font-black text-ink">{name}</Text>
              {rating != null && (
                <View className="ml-2 flex-row items-center">
                  <Ionicons name="star" size={13} color="#F5A623" />
                  <Text className="ml-0.5 text-xs font-bold text-ink">{rating.toFixed(1)}</Text>
                </View>
              )}
            </View>
            <View className="mt-1">
              <LevelBadge level={level} />
            </View>
            <Text className="mt-1 text-xs text-mute">已出動 {completed} 次・{blurb}</Text>
          </View>
        </View>

        {/* 通訊 UI 框架：只有媒合成功（matched）後才出現 */}
        {showChat && (
          <>
            <Text className="mb-2 mt-6 text-base font-black text-ink">與獵人聯絡</Text>
            <View className="rounded-3xl bg-cream p-3" style={shadowSoft}>
              {/* 對方訊息 */}
              <View className="mb-2 max-w-[80%] self-start rounded-2xl rounded-tl-md bg-white px-3 py-2">
                <Text className="text-sm text-ink">收到！我帶傢伙馬上到，先別激怒牠 👍</Text>
              </View>
              {/* 我方訊息 */}
              <View className="mb-3 max-w-[80%] self-end rounded-2xl rounded-tr-md bg-sos px-3 py-2">
                <Text className="text-sm text-white">拜託了，牠超大隻！</Text>
              </View>

              {/* 快速回覆 */}
              <View className="mb-3 flex-row flex-wrap">
                {QUICK_REPLIES.map((q) => (
                  <View key={q} className="mb-2 mr-2 rounded-full border border-wood-200 bg-white px-3 py-1.5">
                    <Text className="text-xs text-ink">{q}</Text>
                  </View>
                ))}
              </View>

              {/* 輸入列（框架） */}
              <View className="flex-row items-center rounded-full bg-white px-3 py-2">
                <Text className="flex-1 text-sm text-mute">傳訊息給 {name}…</Text>
                <View className="h-9 w-9 items-center justify-center rounded-full bg-wood-100">
                  <Ionicons name="call" size={16} color="#9A763C" />
                </View>
                <View className="ml-2 h-9 w-9 items-center justify-center rounded-full bg-sos">
                  <Ionicons name="send" size={15} color="#FFFFFF" />
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* 底部：撲空時回首頁；否則完成任務（demo 用，前往評價）*/}
      <View className="border-t border-wood-100 bg-white px-5 pb-6 pt-3">
        {isEscaped ? (
          <Pressable
            onPress={goHome}
            accessibilityRole="button"
            accessibilityLabel="任務撲空，返回首頁"
            style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}
          >
            <View className="flex-row items-center justify-center rounded-[24px] bg-wood-300 py-4">
              <Ionicons name="home" size={20} color="#FFFFFF" />
              <Text className="ml-2 text-lg font-black text-white">目標逃逸・返回首頁</Text>
            </View>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              completeOrder();
              router.push('/review');
            }}
            accessibilityRole="button"
            accessibilityLabel="獵人已解決，前往評價"
            style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}
          >
            <View className="flex-row items-center justify-center rounded-[24px] bg-ink py-4">
              <Ionicons name="shield-checkmark" size={20} color="#FFFFFF" />
              <Text className="ml-2 text-lg font-black text-white">獵人已解決・前往評價</Text>
            </View>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}
