import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MosaicTarget } from '@/components/mosaic-target';
import { shadowSoft } from '@/constants/shadows';
import { NEARBY_HUNTERS } from '@/data/hunters';
import { successHaptic } from '@/lib/haptics';
import { bumpOrderPrice, cancelOrder, subscribeOrder } from '@/lib/orders';
import { notifyNewOrder } from '@/lib/push';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

const RADAR = 280;
const MATCH_DELAY_MS = 3000;
/** 等這麼久還沒人接，就跳出「加價重發」補救卡 */
const WAIT_HINT_MS = 30000;
/** 每次加價的幅度（提高賞金吸引力）*/
const BUMP_STEP = 30;

/** 由中心向外擴散的脈衝圈 */
function PulseRing({ delay }: { delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, {
          toValue: 1,
          duration: 2400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, delay]);

  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.22, 1] });
  const opacity = v.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.5, 0] });

  return (
    <Animated.View
      className="absolute rounded-full border-2 border-sos"
      style={{ width: RADAR, height: RADAR, transform: [{ scale }], opacity }}
    />
  );
}

export default function MatchingScreen() {
  const confirmMatched = useAppStore((s) => s.confirmMatched);
  const resetOrder = useAppStore((s) => s.resetOrder);
  const orderId = useAppStore((s) => s.orderId);

  const spin = useRef(new Animated.Value(0)).current;
  const onlineCount = NEARBY_HUNTERS.filter((h) => h.online).length;

  // 雷達掃描線持續旋轉
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  // 僅 mock 模式：等 3 秒自動媒合（真實模式改靠下方 Realtime）
  useEffect(() => {
    if (isSupabaseConfigured) return;
    const matched = NEARBY_HUNTERS[0];
    const timer = setTimeout(() => {
      successHaptic();
      confirmMatched(matched.id);
      router.replace('/status');
    }, MATCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [confirmMatched]);

  // Supabase Realtime：訂單被更新為 matched 且有 hunter_id 時，自動進狀態頁
  useEffect(() => {
    if (!orderId) return;
    return subscribeOrder(orderId, (row) => {
      if (row.status === 'matched' && row.hunter_id) {
        successHaptic();
        confirmMatched(row.hunter_id);
        router.replace('/status');
      }
    });
  }, [orderId, confirmMatched]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const cancel = () => {
    if (orderId) cancelOrder(orderId); // 真實模式：將訂單標記為 cancelled
    resetOrder();
    router.replace('/');
  };

  // ── 無人接單補救：等 WAIT_HINT_MS 沒媒合 → 跳出「加價重發」卡 ──
  // round 每加價一次 +1 → 重新計時（隱藏卡片、再等一輪）。
  const [round, setRound] = useState(0);
  const [showRecovery, setShowRecovery] = useState(false);
  const [bumping, setBumping] = useState(false);
  const [bumpedTo, setBumpedTo] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !orderId) return;
    setShowRecovery(false);
    const t = setTimeout(() => setShowRecovery(true), WAIT_HINT_MS);
    return () => clearTimeout(t);
  }, [orderId, round]);

  const rebroadcast = async () => {
    if (!orderId || bumping) return;
    setBumping(true);
    const { price } = await bumpOrderPrice(orderId, BUMP_STEP);
    setBumping(false);
    if (price == null) return; // 已被接走 / 已取消 → 訂閱會處理跳轉，不打擾
    setBumpedTo(price);
    notifyNewOrder(orderId); // 用新賞金重新廣播給線上獵人
    successHaptic();
    setRound((r) => r + 1); // 重新計時
  };

  return (
    <SafeAreaView className="flex-1 items-center justify-between bg-paper py-8">
      <View className="items-center pt-8">
        <Text className="text-2xl font-black text-ink">正在幫你找獵人…</Text>
        <Text className="mt-2 text-sm text-mute">已通知附近 {onlineCount} 位閒置獵人，請稍候</Text>
      </View>

      {/* 雷達 */}
      <View style={{ width: RADAR, height: RADAR }} className="items-center justify-center">
        {/* 靜態同心圓 */}
        <View
          className="absolute rounded-full border border-wood-200"
          style={{ width: RADAR, height: RADAR }}
        />
        <View
          className="absolute rounded-full border border-wood-200"
          style={{ width: RADAR * 0.66, height: RADAR * 0.66 }}
        />
        <View
          className="absolute rounded-full border border-wood-200"
          style={{ width: RADAR * 0.33, height: RADAR * 0.33 }}
        />

        {/* 擴散脈衝 */}
        <PulseRing delay={0} />
        <PulseRing delay={850} />
        <PulseRing delay={1700} />

        {/* 旋轉掃描線（含末端光點） */}
        <Animated.View
          style={{ position: 'absolute', width: RADAR, height: RADAR, transform: [{ rotate }] }}
        >
          <View
            style={{
              position: 'absolute',
              left: RADAR / 2 - 1,
              top: 0,
              width: 2,
              height: RADAR / 2,
              backgroundColor: '#FB6B4B',
            }}
          />
          <View
            className="rounded-full bg-sos"
            style={{ position: 'absolute', left: RADAR / 2 - 5, top: -2, width: 10, height: 10 }}
          />
        </Animated.View>

        {/* 中心：你家（那個就在這） */}
        <View className="items-center justify-center rounded-2xl bg-white p-2" style={shadowSoft}>
          <MosaicTarget size={40} />
        </View>
      </View>

      <View className="w-full items-center px-8">
        {/* 無人接單補救卡：加價重發 */}
        {showRecovery && (
          <View className="mb-4 w-full rounded-3xl bg-white p-4" style={shadowSoft}>
            <View className="flex-row items-center">
              <Ionicons name="trending-up" size={18} color="#FB6B4B" />
              <Text className="ml-2 flex-1 text-sm font-black text-ink">還沒有獵人接單？</Text>
            </View>
            <Text className="mt-1.5 text-xs leading-5 text-mute">
              加 ${BUMP_STEP} 賞金能明顯提高吸引力，並立即重新廣播給附近上線的獵人。
              {bumpedTo != null && (
                <Text className="font-bold text-sos">　目前賞金 ${bumpedTo}</Text>
              )}
            </Text>
            <Pressable
              onPress={rebroadcast}
              disabled={bumping}
              accessibilityRole="button"
              accessibilityLabel={`加價 ${BUMP_STEP} 元並重新廣播`}
              className="mt-3"
              style={({ pressed }) => [
                { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: bumping ? 0.6 : 1 },
              ]}
            >
              <View className="items-center rounded-2xl bg-sos py-3">
                <Text className="text-sm font-black text-white">
                  {bumping ? '重新廣播中…' : `加價 $${BUMP_STEP}・重新廣播`}
                </Text>
              </View>
            </Pressable>
          </View>
        )}

        <Text className="mb-4 text-xs text-mute">通常 10 秒內就會有人接單 🛵</Text>
        <Pressable
          onPress={cancel}
          accessibilityRole="button"
          accessibilityLabel="取消呼救"
          hitSlop={12}
        >
          <Text className="text-sm font-semibold text-mute underline">取消呼救</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
