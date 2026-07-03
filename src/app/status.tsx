import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatBox } from '@/components/chat-box';
import { LevelBadge } from '@/components/level-badge';
import { CANCEL_PENALTY, ESCAPE_FEE, levelFromCompleted } from '@/constants/brand';
import { shadowSoft } from '@/constants/shadows';
import { NEARBY_HUNTERS } from '@/data/hunters';
import { etaMinFromMeters, safeDistanceMeters } from '@/lib/geo';
import { successHaptic } from '@/lib/haptics';
import {
  cancelMatchedOrder,
  confirmCompletion,
  fetchOrder,
  reportNoShow,
  subscribeOrder,
  type OrderRow,
} from '@/lib/orders';
import { fetchProfile, type Profile } from '@/lib/profiles';
import { notifyOrderCompleted } from '@/lib/push';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

const STEPS = ['媒合成功', '獵人出發', '抵達現場', '任務完成'];

export default function StatusScreen() {
  const configured = isSupabaseConfigured;
  const matchedHunterId = useAppStore((s) => s.matchedHunterId);
  const orderId = useAppStore((s) => s.orderId);
  const userId = useAppStore((s) => s.userId);
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

  const name = configured ? (hunterProfile?.display_name ?? '媒合中的獵人') : mockHunter.name;
  const rating = configured ? (hunterProfile?.rating ?? null) : mockHunter.rating;
  const completed = configured ? (hunterProfile?.completed_tasks ?? 0) : mockHunter.kills;
  const level = levelFromCompleted(completed);
  const avatarColor = configured ? '#C9A66B' : mockHunter.avatarColor;
  const avatarUrl = configured ? (hunterProfile?.avatar_url ?? null) : null;
  const blurb = configured ? '準備好拖鞋，正在趕來' : mockHunter.blurb;

  // 對話框在 matched / verifying（等待確認）期間顯示；searching/escaped 不顯示。
  // mock 模式（未設定 Supabase）沒有真實 status，直接視為已媒合。
  const orderStatusDb = orderRow?.status ?? null;
  const showChat = !configured || orderStatusDb === 'matched' || orderStatusDb === 'verifying';
  const isEscaped = orderStatusDb === 'escaped';
  // 進度條：verifying = 獵人已到場處理完畢（等確認）；completed = 全部完成
  const currentStep = orderStatusDb === 'verifying' ? 2 : orderStatusDb === 'completed' ? 3 : 1;

  // 撲空金流透明化：預付總額 − 固定車馬費 = 退回儲值金的差額（讓金流流向一目了然）
  const escapePrice = orderRow?.price ?? null;
  const escapeRefund = escapePrice != null ? Math.max(escapePrice - ESCAPE_FEE, 0) : null;

  const goHome = () => {
    resetOrder();
    router.replace('/');
  };

  // ── 雙重確認結案：獵人回報 verifying → 這裡確認後才真正 completed 撥款 ──
  const [confirming, setConfirming] = useState(false);
  const [verifyDismissed, setVerifyDismissed] = useState(false);
  const showVerifyModal = configured && orderStatusDb === 'verifying' && !verifyDismissed;

  const goReview = () => {
    completeOrder();
    router.push('/review');
  };

  const onConfirmComplete = async () => {
    if (!orderId || confirming) return;
    setConfirming(true);
    const { ok, reason } = await confirmCompletion(orderId);
    setConfirming(false);
    if (!ok) {
      Alert.alert(
        '還無法結案',
        reason === 'not_verifying'
          ? '訂單狀態已變更，請稍後再試。'
          : '目前無法確認完成，請稍後再試。',
      );
      return;
    }
    successHaptic();
    notifyOrderCompleted(orderId); // 推播告知獵人酬勞入帳（fire-and-forget）
    goReview();
  };

  // ── 中途取消（獵人已出發）：收 $100 出勤補償金，其餘退儲值金 ──
  const [cancelling, setCancelling] = useState(false);
  const onCancelMatched = () => {
    if (!orderId || cancelling) return;
    const refund = Math.max((orderRow?.price ?? 0) - CANCEL_PENALTY, 0);
    Alert.alert(
      '獵人已在路上',
      `此時取消將收取 $${CANCEL_PENALTY} 出勤補償金給獵人，其餘 $${refund} 退回你的儲值金錢包。確定要取消嗎？`,
      [
        { text: '不取消了', style: 'cancel' },
        {
          text: '確認取消',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            const { ok, reason } = await cancelMatchedOrder(orderId);
            setCancelling(false);
            if (!ok) {
              Alert.alert(
                '無法取消',
                reason === 'not_matched'
                  ? '訂單狀態已變更（獵人可能已回報解決），請依畫面最新資訊操作。'
                  : '目前無法取消，請稍後再試。',
              );
              return;
            }
            resetOrder();
            router.replace('/');
          },
        },
      ],
    );
  };

  // 惡意佔單防禦：獵人逾時未到 → 回報後訂單退回任務池重新媒合。
  // RPC 內驗證 20 分鐘寬限期 + 呼叫者身分；獵人記一次爽約（3 次停權 24h）。
  const [reporting, setReporting] = useState(false);
  const onReportNoShow = () => {
    if (!orderId || reporting) return;
    Alert.alert('回報獵人未到場？', '訂單會退回任務池重新媒合，該獵人將被記一次未到場。', [
      { text: '再等等', style: 'cancel' },
      {
        text: '確認回報',
        style: 'destructive',
        onPress: async () => {
          setReporting(true);
          const { ok, reason } = await reportNoShow(orderId);
          setReporting(false);
          if (ok) {
            router.replace('/matching'); // 回媒合頁等待新獵人接單
            return;
          }
          Alert.alert(
            '還不能回報',
            reason === 'too_early'
              ? '為保障雙方，媒合滿 20 分鐘後才能回報未到場，再給獵人一點時間。'
              : '目前無法回報，請稍後再試。',
          );
        },
      },
    ]);
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

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 撲空通知（目標逃逸）*/}
        {isEscaped && (
          <View className="mt-2 rounded-3xl bg-wood-50 p-4" style={shadowSoft}>
            <View className="flex-row items-center">
              <MaterialCommunityIcons name="run-fast" size={20} color="#9A763C" />
              <Text className="ml-2 text-sm font-black text-ink">目標已逃逸・任務撲空</Text>
            </View>
            <Text className="mt-2 text-xs leading-5 text-wood-600">
              獵人趕到時目標已不見，僅收取車馬費。金流明細如下：
            </Text>
            {/* 數學透明化：預付總額 − 車馬費 = 退回儲值金 */}
            <View className="mt-2 rounded-2xl bg-white p-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-mute">你預付總額</Text>
                <Text className="text-sm font-bold text-ink">
                  {escapePrice != null ? `$${escapePrice}` : '—'}
                </Text>
              </View>
              <View className="mt-1 flex-row items-center justify-between">
                <Text className="text-xs text-mute">扣除車馬費</Text>
                <Text className="text-sm font-bold text-sos">- ${ESCAPE_FEE}</Text>
              </View>
              <View className="my-2 h-px bg-wood-100" />
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-bold text-ink">退回儲值金錢包</Text>
                <Text className="text-base font-black text-leaf">
                  {escapeRefund != null ? `+ $${escapeRefund}` : '已退回差額'}
                </Text>
              </View>
            </View>
            <Text className="mt-2 text-[11px] text-mute">儲值金可於下次呼救時折抵。</Text>
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
            const done = i <= currentStep;
            return (
              <View key={label} className="flex-1 items-center">
                <View className="w-full flex-row items-center">
                  <View
                    className={`h-1 flex-1 ${i === 0 ? 'opacity-0' : done ? 'bg-sos' : 'bg-wood-100'}`}
                  />
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
                      i === STEPS.length - 1
                        ? 'opacity-0'
                        : i < currentStep
                          ? 'bg-sos'
                          : 'bg-wood-100'
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
            <Text className="mt-1 text-xs text-mute">
              已出動 {completed} 次・{blurb}
            </Text>
          </View>
        </View>

        {/* 獵人逾時未到 → 回報重新媒合（真實模式、matched 期間才顯示） */}
        {configured && orderStatusDb === 'matched' && (
          <Pressable
            onPress={onReportNoShow}
            disabled={reporting}
            accessibilityRole="button"
            accessibilityLabel="回報獵人逾時未到場，重新媒合"
            hitSlop={8}
            className="mt-3 items-center"
          >
            <Text className="text-xs font-semibold text-mute underline">
              {reporting ? '回報中…' : '獵人遲遲未到？回報並重新媒合'}
            </Text>
          </Pressable>
        )}

        {/* 中途取消（獵人已出發）：明確揭露 $100 出勤補償金再確認 */}
        {configured && orderStatusDb === 'matched' && (
          <Pressable
            onPress={onCancelMatched}
            disabled={cancelling}
            accessibilityRole="button"
            accessibilityLabel={`取消呼救，將收取 ${CANCEL_PENALTY} 元出勤補償金`}
            hitSlop={8}
            className="mt-2 items-center"
          >
            <Text className="text-xs font-semibold text-sos underline">
              {cancelling ? '取消中…' : `有急事想取消？將收 $${CANCEL_PENALTY} 出勤補償金`}
            </Text>
          </Pressable>
        )}

        {/* 等待確認提示：關掉 Modal 後仍留一條路回到確認流程 */}
        {configured && orderStatusDb === 'verifying' && verifyDismissed && (
          <Pressable
            onPress={() => setVerifyDismissed(false)}
            accessibilityRole="button"
            accessibilityLabel="獵人已回報解決，重新開啟確認視窗"
            className="mt-4 flex-row items-center justify-center rounded-2xl bg-leaf/10 px-4 py-3"
          >
            <Ionicons name="shield-checkmark" size={16} color="#7FB069" />
            <Text className="ml-2 text-sm font-bold text-leaf">獵人回報已解決 → 點我確認結案</Text>
          </Pressable>
        )}

        {/* 即時聊天：只有媒合成功（matched）後才出現 */}
        {showChat && (
          <>
            <Text className="mb-2 mt-6 text-base font-black text-ink">與 {name} 聯絡</Text>
            <ChatBox orderId={orderId} selfId={userId} peerName={name} />
          </>
        )}
      </ScrollView>

      {/* 底部主按鈕：依訂單狀態切換（雙重確認結案機制） */}
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
        ) : !configured ? (
          /* mock demo：沒有真實狀態機，保留一鍵前往評價 */
          <Pressable
            onPress={goReview}
            accessibilityRole="button"
            accessibilityLabel="獵人已解決，前往評價"
            style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}
          >
            <View className="flex-row items-center justify-center rounded-[24px] bg-ink py-4">
              <Ionicons name="shield-checkmark" size={20} color="#FFFFFF" />
              <Text className="ml-2 text-lg font-black text-white">獵人已解決・前往評價</Text>
            </View>
          </Pressable>
        ) : orderStatusDb === 'verifying' ? (
          <Pressable
            onPress={onConfirmComplete}
            disabled={confirming}
            accessibilityRole="button"
            accessibilityLabel="確認獵人已解決，結案並撥款"
            style={({ pressed }) => [
              {
                transform: [{ scale: pressed ? 0.98 : 1 }],
                opacity: confirming ? 0.6 : 1,
              },
            ]}
          >
            <View className="flex-row items-center justify-center rounded-[24px] bg-leaf py-4">
              <Ionicons name="shield-checkmark" size={20} color="#FFFFFF" />
              <Text className="ml-2 text-lg font-black text-white">
                {confirming ? '結案中…' : '確認完成・撥款並評價'}
              </Text>
            </View>
          </Pressable>
        ) : orderStatusDb === 'completed' ? (
          <Pressable
            onPress={goReview}
            accessibilityRole="button"
            accessibilityLabel="已結案，前往評價"
            style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}
          >
            <View className="flex-row items-center justify-center rounded-[24px] bg-ink py-4">
              <Ionicons name="star" size={20} color="#FFFFFF" />
              <Text className="ml-2 text-lg font-black text-white">已結案・前往評價</Text>
            </View>
          </Pressable>
        ) : (
          /* matched / searching：結案主導權在獵人回報，先鎖住按鈕 */
          <View className="flex-row items-center justify-center rounded-[24px] bg-wood-100 py-4">
            <Ionicons name="hourglass-outline" size={18} color="#9A8F80" />
            <Text className="ml-2 text-base font-black text-mute">獵人處理完會請你確認結案</Text>
          </View>
        )}
      </View>

      {/* 雙重確認 Modal：獵人回報已解決 → 求救者滿版確認 */}
      <Modal
        visible={showVerifyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setVerifyDismissed(true)}
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-8">
          <View className="w-full rounded-[28px] bg-white p-6">
            <Text className="text-center text-4xl">🎉</Text>
            <Text className="mt-2 text-center text-xl font-black text-ink">
              獵人回報已消滅目標！
            </Text>
            <Text className="mt-2 text-center text-sm leading-6 text-mute">
              請確認現場狀況。按下「確認完成」後訂單才會結案，酬勞才會撥給獵人。
            </Text>
            <Pressable
              onPress={onConfirmComplete}
              disabled={confirming}
              accessibilityRole="button"
              accessibilityLabel="確認完成，結案並前往評價"
              className="mt-5"
              style={({ pressed }) => [
                {
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  opacity: confirming ? 0.6 : 1,
                },
              ]}
            >
              <View className="flex-row items-center justify-center rounded-[24px] bg-leaf py-4">
                <Ionicons name="shield-checkmark" size={20} color="#FFFFFF" />
                <Text className="ml-2 text-lg font-black text-white">
                  {confirming ? '結案中…' : '確認完成・前往評價'}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => setVerifyDismissed(true)}
              accessibilityRole="button"
              accessibilityLabel="還沒確認，先回到畫面查看"
              hitSlop={8}
              className="mt-3 items-center"
            >
              <Text className="text-xs font-semibold text-mute underline">
                還沒解決？我再看看現場
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
