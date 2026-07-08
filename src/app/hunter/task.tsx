import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, AppState, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatBox } from '@/components/chat-box';
import { ReportBlockButton } from '@/components/report-block';
import { ESCAPE_FEE, TARGET_TIERS } from '@/constants/brand';
import { shadowSoft, shadowSos } from '@/constants/shadows';
import { SOS_TASKS, netEarning, tierOf } from '@/data/tasks';
import { etaMinFromMeters, safeDistanceMeters } from '@/lib/geo';
import { successHaptic } from '@/lib/haptics';
import {
  fetchOrder,
  fetchOrderPrivate,
  reportResolved,
  settleEscaped,
  subscribeOrder,
  tierIdFromSize,
  type OrderPrivate,
  type OrderRow,
} from '@/lib/orders';
import { bumpCompletedTasks, fetchProfile, type Profile } from '@/lib/profiles';
import { notifyOrderVerifying } from '@/lib/push';
import { useAppStore } from '@/store/useAppStore';

function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function HunterTaskScreen() {
  const acceptedOrder = useAppStore((s) => s.acceptedOrder);
  const acceptedTaskId = useAppStore((s) => s.acceptedTaskId);
  const userLocation = useAppStore((s) => s.userLocation);
  const userId = useAppStore((s) => s.userId);
  const finishTask = useAppStore((s) => s.finishTask);

  // 真實模式用搶到的訂單；否則退回 mock 任務
  const mockTask = SOS_TASKS.find((t) => t.id === acceptedTaskId) ?? SOS_TASKS[0];
  const tier = acceptedOrder
    ? TARGET_TIERS.find((t) => t.id === tierIdFromSize(acceptedOrder.target_size))!
    : tierOf(mockTask);
  const price = acceptedOrder ? (acceptedOrder.price ?? tier.price) : tier.price;
  const net = netEarning(price);
  // 防呆：座標無效（缺失 / (0,0)）→ null → 顯示「距離計算中…」、ETA 退回預設值
  const distanceM = acceptedOrder
    ? safeDistanceMeters(userLocation, {
        latitude: acceptedOrder.location_lat,
        longitude: acceptedOrder.location_lng,
      })
    : mockTask.distanceM;
  const etaMin = acceptedOrder
    ? distanceM != null
      ? etaMinFromMeters(distanceM)
      : 10
    : mockTask.etaMin;

  // 接單後才解鎖：用 fetchOrderPrivate 取私密資料（精確地址 / 進入指引）。
  // order_private 的 RLS 確保只有已媒合的本獵人拿得到 → DB 級隱私。
  const [priv, setPriv] = useState<OrderPrivate | null>(null);
  useEffect(() => {
    if (!acceptedOrder?.id) return;
    let active = true;
    fetchOrderPrivate(acceptedOrder.id).then((p) => active && p && setPriv(p));
    return () => {
      active = false;
    };
  }, [acceptedOrder?.id]);

  const address = acceptedOrder ? (priv?.exact_address ?? '解鎖地址中…') : mockTask.address;
  const entryInstructions = priv?.entry_instructions ?? null;

  // 讀取對方（求救者）的真實 profile
  const [client, setClient] = useState<Profile | null>(null);
  useEffect(() => {
    if (!acceptedOrder?.client_id) return;
    let active = true;
    fetchProfile(acceptedOrder.client_id).then((p) => active && setClient(p));
    return () => {
      active = false;
    };
  }, [acceptedOrder?.client_id]);
  const clientName = client?.display_name ?? '求救者';

  // 雙重確認結案：回報已解決後進入 verifying，等求救者按「確認完成」
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  // 斷線防護網：訂閱訂單狀態 + 回前景時強制 refetch（隧道斷網情境）。
  // 求救者在獵人斷網期間取消、或訂單被逾時回收（report_no_show）時，
  // 恢復連線的瞬間立刻得知並退出，不會停在一張已不存在的任務上。
  // 求救者按下「確認完成」時（verifying → completed），這裡收到事件 →
  // 提示酬勞入帳並返回任務池（完成數已由 confirm_completion RPC 在 DB 端 +1）。
  useEffect(() => {
    const id = acceptedOrder?.id;
    if (!id) return;
    let done = false;
    const onRow = (row: OrderRow) => {
      if (done) return;
      if (row.status === 'verifying') {
        setAwaitingConfirm(true); // 斷線重連後補回「等待確認中」狀態
        return;
      }
      if (row.status === 'completed') {
        done = true;
        successHaptic();
        Alert.alert('任務完成 🎉', '求救者已確認完成，酬勞已入帳你的錢包。可到歷史紀錄評價對方。');
        finishTask();
        router.replace('/hunter');
        return;
      }
      const cancelled = row.status === 'cancelled';
      // searching = 被逾時回收；hunter_id 換人 = 回收後已被別人接走
      const reclaimed =
        row.status === 'searching' || (row.hunter_id != null && row.hunter_id !== userId);
      if (!cancelled && !reclaimed) return;
      done = true;
      Alert.alert(
        '任務已結束',
        cancelled ? '求救者已取消這次呼救。' : '這張單因逾時未到已被重新釋出。',
      );
      finishTask();
      router.replace('/hunter');
    };
    const unsub = subscribeOrder(id, onRow);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') fetchOrder(id).then((o) => o && onRow(o));
    });
    return () => {
      unsub();
      sub.remove();
    };
  }, [acceptedOrder?.id, userId, finishTask]);

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

  const [completing, setCompleting] = useState(false);
  const complete = async () => {
    if (completing) return;
    setCompleting(true);
    try {
      if (acceptedOrder) {
        // 雙重確認結案：matched → verifying，等求救者按「確認完成」才真正結案撥款。
        // 若求救者已在斷線期間取消 → ok:false，不進等待狀態（杜絕殭屍任務）。
        const { ok, awaiting } = await reportResolved(acceptedOrder.id);
        if (!ok) {
          Alert.alert('訂單已結束', '這張單已被求救者取消或已結案，無法回報完成。');
          finishTask();
          router.replace('/hunter');
          return;
        }
        if (awaiting) {
          successHaptic();
          notifyOrderVerifying(acceptedOrder.id); // 推播請求救者回來確認
          setAwaitingConfirm(true);
          return;
        }
        // 後備路徑（DB 尚未跑第十六階段 SQL）：維持舊版直接完成 + 本地 +1
        bumpCompletedTasks(userId);
      }
      successHaptic();
      finishTask();
      router.replace('/hunter');
    } finally {
      setCompleting(false);
    }
  };

  // 撲空：目標逃逸 → 僅收 $150 車馬費，差額退還發單者儲值金（RPC 原子結算）
  const [settling, setSettling] = useState(false);
  const reportEscaped = () => {
    Alert.alert(
      '目標已逃逸？',
      `將以撲空結案：你獲得 $${ESCAPE_FEE} 車馬費，發單者預付的差額會自動退成儲值金。`,
      [
        { text: '再找找', style: 'cancel' },
        {
          text: '確認逃逸・收車馬費',
          style: 'destructive',
          onPress: async () => {
            if (settling) return;
            setSettling(true);
            try {
              if (acceptedOrder) {
                const { error } = await settleEscaped(acceptedOrder.id);
                if (error) {
                  Alert.alert('結算失敗', error);
                  return;
                }
              }
              successHaptic();
              finishTask();
              router.replace('/hunter');
            } finally {
              setSettling(false);
            }
          },
        },
      ],
    );
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

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 倒數計時 */}
        <View className="mt-2 items-center rounded-[28px] bg-ink py-6" style={shadowSoft}>
          <Text className="text-xs font-semibold text-silver">
            {arrived ? '你已抵達現場' : '預計抵達倒數'}
          </Text>
          <Text
            className="mt-1 text-6xl font-black text-white"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {arrived ? '00:00' : mmss(secs)}
          </Text>
          <Text className="mt-1 text-xs text-silver">
            距離 {distanceM == null ? '定位計算中…' : `${distanceM} m`}
            ・這趟淨收益 <Text className="font-bold text-leaf">${net}</Text>
          </Text>
        </View>

        {/* 目標資訊 */}
        <View className="mt-4 flex-row items-center rounded-3xl bg-white p-4" style={shadowSoft}>
          <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-wood-300">
            {client?.avatar_url ? (
              <Image source={{ uri: client.avatar_url }} style={{ width: 48, height: 48 }} />
            ) : (
              <FontAwesome5 name="map-marker-alt" size={18} color="#FFFFFF" />
            )}
          </View>
          <View className="ml-3 flex-1">
            <View className="flex-row items-center">
              <Text className="text-sm font-bold text-ink">{clientName}</Text>
              {client != null && (
                <View className="ml-1.5 flex-row items-center">
                  <Ionicons name="star" size={11} color="#F5A623" />
                  <Text className="ml-0.5 text-[11px] font-bold text-ink">
                    {client.rating.toFixed(1)}
                  </Text>
                </View>
              )}
            </View>
            <Text className="text-xs text-mute">
              {tier.label}・{address}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-[11px] text-mute">目標</Text>
            <Text className="text-sm font-black text-ink">{tier.hint}</Text>
          </View>
          {acceptedOrder?.client_id && (
            <ReportBlockButton
              selfId={userId}
              targetId={acceptedOrder.client_id}
              targetName={clientName}
              orderId={acceptedOrder.id}
            />
          )}
        </View>

        {/* 接單後解鎖：精確地址 + 進入指引 */}
        <View className="mt-4 rounded-3xl bg-leaf/10 p-4" style={shadowSoft}>
          <View className="flex-row items-center">
            <Ionicons name="lock-open" size={14} color="#7FB069" />
            <Text className="ml-1.5 text-xs font-bold text-leaf">已解鎖・精確地址</Text>
          </View>
          <Text className="mt-1.5 text-base font-black text-ink">{address}</Text>
          {entryInstructions ? (
            <View className="mt-3 flex-row items-start rounded-2xl bg-white px-3 py-2.5">
              <Ionicons name="enter-outline" size={16} color="#9A763C" />
              <View className="ml-2 flex-1">
                <Text className="text-[11px] text-mute">進入指引</Text>
                <Text className="mt-0.5 text-sm text-ink">{entryInstructions}</Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* 與求救者即時聊天 */}
        <Text className="mb-2 mt-6 text-base font-black text-ink">與 {clientName} 聯絡</Text>
        <ChatBox orderId={acceptedOrder?.id ?? null} selfId={userId} peerName={clientName} />
      </ScrollView>

      {/* 底部：等待確認中 / 完成任務 / 目標逃逸 */}
      <View className="border-t border-wood-100 bg-white px-5 pb-6 pt-3">
        {awaitingConfirm ? (
          <View className="items-center rounded-[24px] bg-cream py-4">
            <View className="flex-row items-center">
              <MaterialCommunityIcons name="timer-sand" size={18} color="#9A763C" />
              <Text className="ml-2 text-base font-black text-ink">等待求救者確認中…</Text>
            </View>
            <Text className="mt-1 text-[11px] text-mute">
              對方按下「確認完成」後，酬勞 ${net} 會自動入帳你的錢包
            </Text>
          </View>
        ) : (
          <>
            <Pressable
              onPress={complete}
              disabled={completing}
              accessibilityRole="button"
              accessibilityLabel="回報已解決，完成任務"
              style={({ pressed }) => [
                shadowSos,
                {
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  opacity: completing ? 0.6 : 1,
                },
              ]}
            >
              <View className="flex-row items-center justify-center rounded-[24px] bg-sos py-4">
                <FontAwesome5 name="shoe-prints" size={16} color="#FFFFFF" />
                <Text className="ml-2 text-lg font-black text-white">
                  {completing ? '回報中…' : '回報已解決・完成任務'}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={reportEscaped}
              disabled={settling}
              accessibilityRole="button"
              accessibilityLabel={`目標逃逸，收取 ${ESCAPE_FEE} 元車馬費`}
              className="mt-3"
              style={({ pressed }) => [
                {
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  opacity: settling ? 0.6 : 1,
                },
              ]}
            >
              <View className="flex-row items-center justify-center rounded-[24px] border border-wood-200 bg-white py-3.5">
                <MaterialCommunityIcons name="run-fast" size={18} color="#9A763C" />
                <Text className="ml-2 text-sm font-bold text-wood-600">
                  {settling ? '結算中…' : `目標逃逸・收 $${ESCAPE_FEE} 車馬費`}
                </Text>
              </View>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
