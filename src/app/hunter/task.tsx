import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TARGET_TIERS } from '@/constants/brand';
import { shadowSoft, shadowSos } from '@/constants/shadows';
import { SOS_TASKS, netEarning, tierOf } from '@/data/tasks';
import { etaMinFromMeters, safeDistanceMeters } from '@/lib/geo';
import { successHaptic } from '@/lib/haptics';
import { completeOrderDb, tierIdFromSize } from '@/lib/orders';
import { fetchProfile, type Profile } from '@/lib/profiles';
import { useAppStore } from '@/store/useAppStore';

const QUICK_REPLIES = ['我出發了，5 分鐘到', '請先別激怒牠 🙏', '門口到了，幫我開門', '收工！已解決 ✌️'];

function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function HunterTaskScreen() {
  const acceptedOrder = useAppStore((s) => s.acceptedOrder);
  const acceptedTaskId = useAppStore((s) => s.acceptedTaskId);
  const userLocation = useAppStore((s) => s.userLocation);
  const finishTask = useAppStore((s) => s.finishTask);

  // 真實模式用搶到的訂單；否則退回 mock 任務
  const mockTask = SOS_TASKS.find((t) => t.id === acceptedTaskId) ?? SOS_TASKS[0];
  const tier = acceptedOrder
    ? TARGET_TIERS.find((t) => t.id === tierIdFromSize(acceptedOrder.target_size))!
    : tierOf(mockTask);
  const price = acceptedOrder ? acceptedOrder.price ?? tier.price : tier.price;
  const net = netEarning(price);
  // 防呆：座標無效（缺失 / (0,0)）→ null → 顯示「距離計算中…」、ETA 退回預設值
  const distanceM = acceptedOrder
    ? safeDistanceMeters(userLocation, {
        latitude: acceptedOrder.location_lat,
        longitude: acceptedOrder.location_lng,
      })
    : mockTask.distanceM;
  const etaMin = acceptedOrder ? (distanceM != null ? etaMinFromMeters(distanceM) : 10) : mockTask.etaMin;
  const address = acceptedOrder ? '地圖上的呼救位置' : mockTask.address;

  // 讀取對方（鎮宅金主）的真實 profile
  const [client, setClient] = useState<Profile | null>(null);
  useEffect(() => {
    if (!acceptedOrder?.client_id) return;
    let active = true;
    fetchProfile(acceptedOrder.client_id).then((p) => active && setClient(p));
    return () => {
      active = false;
    };
  }, [acceptedOrder?.client_id]);
  const clientName = client?.display_name ?? '鎮宅金主';

  // 倒數秒數再夾一層：不合理（NaN / 負 / 超過 2 小時）一律退回 10:00
  const initialSecs = Number.isFinite(etaMin) && etaMin > 0 && etaMin <= 120 ? etaMin * 60 : 600;
  const [secs, setSecs] = useState(initialSecs);

  useEffect(() => {
    const id = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) {
          clearInterval(id);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const arrived = secs === 0;

  const complete = () => {
    successHaptic();
    if (acceptedOrder) completeOrderDb(acceptedOrder.id); // 真實模式：標記完成
    finishTask();
    router.replace('/hunter');
  };

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      {/* 標題列 */}
      <View className="flex-row items-center px-4 pb-2 pt-1">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回任務池"
          className="h-10 w-10 items-center justify-center rounded-full bg-cream"
        >
          <Ionicons name="chevron-back" size={22} color="#2A2521" />
        </Pressable>
        <View className="ml-3">
          <Text className="text-xl font-black text-ink">前往救援中</Text>
          <Text className="text-xs text-mute">{address}</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        {/* 倒數計時 */}
        <View className="mt-2 items-center rounded-[28px] bg-ink py-6" style={shadowSoft}>
          <Text className="text-xs font-semibold text-silver">{arrived ? '你已抵達現場' : '預計抵達倒數'}</Text>
          <Text className="mt-1 text-6xl font-black text-white" style={{ fontVariant: ['tabular-nums'] }}>
            {arrived ? '00:00' : mmss(secs)}
          </Text>
          <Text className="mt-1 text-xs text-silver">
            距離 {distanceM == null ? '定位計算中…' : `${distanceM} m`}・這趟淨收益{' '}
            <Text className="font-bold text-leaf">${net}</Text>
          </Text>
        </View>

        {/* 目標資訊 */}
        <View className="mt-4 flex-row items-center rounded-3xl bg-white p-4" style={shadowSoft}>
          <View className="h-12 w-12 items-center justify-center rounded-full bg-wood-300">
            <FontAwesome5 name="map-marker-alt" size={18} color="#FFFFFF" />
          </View>
          <View className="ml-3 flex-1">
            <View className="flex-row items-center">
              <Text className="text-sm font-bold text-ink">{clientName}</Text>
              {client != null && (
                <View className="ml-1.5 flex-row items-center">
                  <Ionicons name="star" size={11} color="#F5A623" />
                  <Text className="ml-0.5 text-[11px] font-bold text-ink">{client.rating.toFixed(1)}</Text>
                </View>
              )}
            </View>
            <Text className="text-xs text-mute">{tier.label}・{address}</Text>
          </View>
          <View className="items-end">
            <Text className="text-[11px] text-mute">目標</Text>
            <Text className="text-sm font-black text-ink">{tier.hint}</Text>
          </View>
        </View>

        {/* 與求救者對話 */}
        <Text className="mb-2 mt-6 text-base font-black text-ink">與 {clientName} 聯絡</Text>
        <View className="rounded-3xl bg-cream p-3" style={shadowSoft}>
          <View className="mb-2 max-w-[80%] self-start rounded-2xl rounded-tl-md bg-white px-3 py-2">
            <Text className="text-sm text-ink">獵人你好！牠在{tier.label === '會飛的' ? '天花板' : '角落'}，拜託小心 🙏</Text>
          </View>
          <View className="mb-3 max-w-[80%] self-end rounded-2xl rounded-tr-md bg-sos px-3 py-2">
            <Text className="text-sm text-white">收到，馬上到，準備好拖鞋了 🩴</Text>
          </View>

          <View className="mb-3 flex-row flex-wrap">
            {QUICK_REPLIES.map((q) => (
              <View key={q} className="mb-2 mr-2 rounded-full border border-wood-200 bg-white px-3 py-1.5">
                <Text className="text-xs text-ink">{q}</Text>
              </View>
            ))}
          </View>

          <View className="flex-row items-center rounded-full bg-white px-3 py-2">
            <Text className="flex-1 text-sm text-mute">傳訊息給金主…</Text>
            <View className="h-9 w-9 items-center justify-center rounded-full bg-wood-100">
              <Ionicons name="call" size={16} color="#9A763C" />
            </View>
            <View className="ml-2 h-9 w-9 items-center justify-center rounded-full bg-sos">
              <Ionicons name="send" size={15} color="#FFFFFF" />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* 底部：完成任務 */}
      <View className="border-t border-wood-100 bg-white px-5 pb-6 pt-3">
        <Pressable
          onPress={complete}
          accessibilityRole="button"
          accessibilityLabel="回報已解決，完成任務"
          style={({ pressed }) => [shadowSos, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <View className="flex-row items-center justify-center rounded-[24px] bg-sos py-4">
            <FontAwesome5 name="shoe-prints" size={16} color="#FFFFFF" />
            <Text className="ml-2 text-lg font-black text-white">回報已解決・完成任務</Text>
          </View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
