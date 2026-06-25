import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MosaicTarget } from '@/components/mosaic-target';
import { BRAND } from '@/constants/brand';
import { CURRENT_USER, NEARBY_HUNTERS } from '@/data/hunters';

const cardShadow = {
  shadowColor: '#2A2521',
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

const hunter = NEARBY_HUNTERS[0];
const PRAISE_TAGS = ['手腳俐落', '很準時', '有禮貌', '善後乾淨', '一擊必殺'];

export default function ReviewScreen() {
  const [rating, setRating] = useState(5);
  const [tags, setTags] = useState<string[]>(['一擊必殺']);

  // 稱號解鎖動畫：掛載後彈入
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(300),
      Animated.spring(reveal, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
    ]).start();
  }, [reveal]);

  // 徽章光澤掃過
  const shine = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shine, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(1400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shine]);

  const cardScale = reveal.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const shineX = shine.interpolate({ inputRange: [0, 1], outputRange: [-120, 220] });

  const toggleTag = (t: string) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      {/* 標題列 */}
      <View className="flex-row items-center justify-between px-4 pb-2 pt-1">
        <Text className="text-xl font-black text-ink">任務完成！</Text>
        <Pressable
          onPress={() => router.replace('/')}
          className="h-10 w-10 items-center justify-center rounded-full bg-cream"
        >
          <Ionicons name="close" size={20} color="#2A2521" />
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        {/* 成功封印 */}
        <View className="mt-2 items-center rounded-[28px] bg-cream py-7" style={cardShadow}>
          <View className="opacity-30">
            <MosaicTarget size={48} vibrate={false} />
          </View>
          <View className="-mt-6 h-14 w-14 items-center justify-center rounded-full bg-leaf" style={cardShadow}>
            <Ionicons name="checkmark" size={30} color="#FFFFFF" />
          </View>
          <Text className="mt-3 text-lg font-black text-ink">那個・已退散 🎉</Text>
          <Text className="mt-1 text-xs text-mute">家裡恢復和平，可以安心睡了</Text>
        </View>

        {/* 解鎖稱號動畫卡 */}
        <Animated.View
          className="mt-5 overflow-hidden rounded-[28px] bg-ink p-5"
          style={[{ transform: [{ scale: cardScale }], opacity: reveal }, cardShadow]}
        >
          <View className="flex-row items-center">
            <MaterialCommunityIcons name="trophy-variant" size={18} color="#C3C9D2" />
            <Text className="ml-2 text-xs font-bold tracking-widest text-silver">稱號解鎖</Text>
          </View>

          <View className="mt-3 flex-row items-center">
            {/* 金屬銀徽章 */}
            <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-silver">
              <MaterialCommunityIcons name="shield-crown" size={30} color="#FFFFFF" />
              {/* 掃光 */}
              <Animated.View
                className="absolute h-24 w-8 bg-white/40"
                style={{ transform: [{ translateX: shineX }, { rotate: '20deg' }] }}
              />
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-2xl font-black text-white">{CURRENT_USER.title}</Text>
              <Text className="mt-0.5 text-xs text-silver">
                累積救援 {CURRENT_USER.rescued + 1} 次・解鎖鎮宅金主特權
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* 幫獵人評分 */}
        <Text className="mb-3 mt-6 text-base font-black text-ink">幫 {hunter.name} 打個分數</Text>
        <View className="rounded-3xl bg-white p-4" style={cardShadow}>
          <View className="flex-row items-center justify-center">
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setRating(n)} className="px-1.5">
                <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={36} color="#F5A623" />
              </Pressable>
            ))}
          </View>

          <View className="mt-4 flex-row flex-wrap justify-center">
            {PRAISE_TAGS.map((t) => {
              const on = tags.includes(t);
              return (
                <Pressable key={t} onPress={() => toggleTag(t)} className="mb-2 mr-2">
                  <View
                    className={`rounded-full border px-3 py-1.5 ${
                      on ? 'border-sos bg-sos/10' : 'border-wood-200 bg-white'
                    }`}
                  >
                    <Text className={`text-xs font-semibold ${on ? 'text-sos' : 'text-mute'}`}>{t}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 對方也給了你評價 */}
        <View className="mt-4 flex-row items-center rounded-3xl bg-wood-50 px-4 py-3" style={cardShadow}>
          <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: hunter.avatarColor }}>
            <Text className="text-base font-black text-white">{hunter.name[0]}</Text>
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-sm font-bold text-ink">{hunter.name} 也給了你 5.0★</Text>
            <Text className="text-xs text-mute">「金主超好溝通，現場有先收乾淨，讚！」</Text>
          </View>
        </View>
      </ScrollView>

      {/* 底部 */}
      <View className="border-t border-wood-100 bg-white px-5 pb-6 pt-3">
        <Pressable
          onPress={() => router.replace('/')}
          style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <View className="flex-row items-center justify-center rounded-[24px] bg-sos py-4">
            <Text className="text-lg font-black text-white">送出評價・完成</Text>
          </View>
        </Pressable>
        <Text className="mt-2 text-center text-[11px] text-mute">感謝使用 {BRAND.appName}，祝你一夜好眠</Text>
      </View>
    </SafeAreaView>
  );
}
