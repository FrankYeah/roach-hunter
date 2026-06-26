import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MosaicTarget } from '@/components/mosaic-target';
import { shadowSoft } from '@/constants/shadows';
import { NEARBY_HUNTERS } from '@/data/hunters';
import { successHaptic } from '@/lib/haptics';
import { useAppStore } from '@/store/useAppStore';

const RADAR = 280;
const MATCH_DELAY_MS = 3000;

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

  // 模擬等待 3 秒 → 媒合成功 → 自動導向狀態頁
  useEffect(() => {
    const matched = NEARBY_HUNTERS[0];
    const timer = setTimeout(() => {
      successHaptic();
      confirmMatched(matched.id);
      router.replace('/status');
    }, MATCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [confirmMatched]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const cancel = () => {
    resetOrder();
    router.replace('/');
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
        <View className="absolute rounded-full border border-wood-200" style={{ width: RADAR, height: RADAR }} />
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
            style={{ position: 'absolute', left: RADAR / 2 - 1, top: 0, width: 2, height: RADAR / 2, backgroundColor: '#FB6B4B' }}
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
        <Text className="mb-4 text-xs text-mute">通常 10 秒內就會有人接單 🛵</Text>
        <Pressable onPress={cancel} accessibilityRole="button" accessibilityLabel="取消呼救" hitSlop={12}>
          <Text className="text-sm font-semibold text-mute underline">取消呼救</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
