import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RankBadge } from '@/components/rank-badge';
import { shadowSoft } from '@/constants/shadows';
import { NEARBY_HUNTERS } from '@/data/hunters';
import { useAppStore } from '@/store/useAppStore';

const STEPS = ['媒合成功', '獵人出發', '抵達現場', '任務完成'];
const CURRENT_STEP = 1;

const QUICK_REPLIES = ['門口在鞋櫃旁 🙏', '牠在廚房水槽！', '我先去房間躲一下', '拜託快一點 😭'];

export default function StatusScreen() {
  const matchedHunterId = useAppStore((s) => s.matchedHunterId);
  const completeOrder = useAppStore((s) => s.completeOrder);
  // 媒合到的獵人（取流程中媒合的那位，否則退回最近的白金殺手）
  const hunter = NEARBY_HUNTERS.find((h) => h.id === matchedHunterId) ?? NEARBY_HUNTERS[0];

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
        {/* ETA 大字 */}
        <View className="mt-2 items-center rounded-[28px] bg-sos/10 py-6" style={shadowSoft}>
          <Text className="text-xs font-semibold text-sos">預計抵達時間</Text>
          <View className="mt-1 flex-row items-end">
            <Text className="text-6xl font-black text-sos">{hunter.etaMin}</Text>
            <Text className="mb-2 ml-1 text-xl font-bold text-sos">分鐘</Text>
          </View>
          <Text className="mt-1 text-xs text-mute">距離你家約 {hunter.distanceM} 公尺</Text>
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
            className="h-16 w-16 items-center justify-center rounded-full border-[3px] border-white"
            style={{ backgroundColor: hunter.avatarColor, ...shadowSoft }}
          >
            <FontAwesome5 name="shoe-prints" size={24} color="#FFFFFF" />
          </View>
          <View className="ml-4 flex-1">
            <View className="flex-row items-center">
              <Text className="text-lg font-black text-ink">{hunter.name}</Text>
              <View className="ml-2 flex-row items-center">
                <Ionicons name="star" size={13} color="#F5A623" />
                <Text className="ml-0.5 text-xs font-bold text-ink">{hunter.rating}</Text>
              </View>
            </View>
            <View className="mt-1">
              <RankBadge rank={hunter.rank} />
            </View>
            <Text className="mt-1 text-xs text-mute">已出動 {hunter.kills} 次・{hunter.blurb}</Text>
          </View>
        </View>

        {/* 通訊 UI 框架 */}
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
            <Text className="flex-1 text-sm text-mute">傳訊息給 {hunter.name}…</Text>
            <View className="h-9 w-9 items-center justify-center rounded-full bg-wood-100">
              <Ionicons name="call" size={16} color="#9A763C" />
            </View>
            <View className="ml-2 h-9 w-9 items-center justify-center rounded-full bg-sos">
              <Ionicons name="send" size={15} color="#FFFFFF" />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* 底部：完成任務（demo 用，前往評價）*/}
      <View className="border-t border-wood-100 bg-white px-5 pb-6 pt-3">
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
      </View>
    </SafeAreaView>
  );
}
