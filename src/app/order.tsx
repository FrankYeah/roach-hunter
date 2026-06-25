import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MosaicTarget } from '@/components/mosaic-target';
import { ADDONS, BRAND, CHASE_FEE, TARGET_TIERS, type TargetTier } from '@/constants/brand';
import { CURRENT_USER } from '@/data/hunters';

const cardShadow = {
  shadowColor: '#2A2521',
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

/** 現場狀況選項卡 */
function TierCard({
  tier,
  selected,
  onPress,
}: {
  tier: TargetTier;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="mb-3">
      <View
        className={`flex-row items-center rounded-3xl border-2 px-4 py-4 ${
          selected ? 'border-sos bg-sos/10' : 'border-wood-100 bg-white'
        }`}
        style={selected ? undefined : cardShadow}
      >
        {/* 用馬賽克方塊大小隱喻體型 */}
        <View className="h-16 w-16 items-center justify-center rounded-2xl bg-cream">
          <MosaicTarget size={32 + tier.mosaic * 8} vibrate={selected} />
        </View>

        <View className="ml-4 flex-1">
          <Text className="text-lg font-black text-ink">{tier.label}</Text>
          <Text className="mt-0.5 text-xs text-mute">{tier.hint}</Text>
        </View>

        <View className="items-end">
          <Text className={`text-xl font-black ${selected ? 'text-sos' : 'text-ink'}`}>
            ${tier.price}
          </Text>
          <View
            className={`mt-1 h-6 w-6 items-center justify-center rounded-full ${
              selected ? 'bg-sos' : 'bg-wood-100'
            }`}
          >
            {selected && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default function OrderScreen() {
  const [tierId, setTierId] = useState<TargetTier['id']>('big');
  const [addonIds, setAddonIds] = useState<string[]>([]);

  const tier = TARGET_TIERS.find((t) => t.id === tierId)!;
  const addonTotal = ADDONS.filter((a) => addonIds.includes(a.id)).reduce((s, a) => s + a.price, 0);
  const total = tier.price + addonTotal;

  const toggleAddon = (id: string) =>
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      {/* 標題列 */}
      <View className="flex-row items-center px-4 pb-2 pt-1">
        <Pressable
          onPress={() => router.back()}
          className="h-10 w-10 items-center justify-center rounded-full bg-cream"
        >
          <Ionicons name="chevron-back" size={22} color="#2A2521" />
        </Pressable>
        <View className="ml-3">
          <Text className="text-xl font-black text-ink">{BRAND.sosLabel}</Text>
          <Text className="text-xs text-mute">選擇現場狀況，馬上幫你媒合獵人</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {/* 地點 */}
        <View className="mb-5 mt-2 flex-row items-center rounded-3xl bg-cream px-4 py-3" style={cardShadow}>
          <View className="h-9 w-9 items-center justify-center rounded-full bg-wood-300">
            <Ionicons name="location" size={18} color="#FFFFFF" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-[11px] text-mute">救援地點</Text>
            <Text className="text-sm font-bold text-ink">{CURRENT_USER.address}</Text>
          </View>
          <Text className="text-xs font-semibold text-sos">變更</Text>
        </View>

        {/* 現場狀況 */}
        <Text className="mb-3 text-base font-black text-ink">那個・長怎樣？</Text>
        {TARGET_TIERS.map((t) => (
          <TierCard key={t.id} tier={t} selected={t.id === tierId} onPress={() => setTierId(t.id)} />
        ))}

        {/* 車馬費備註 */}
        <View className="mt-1 flex-row items-start rounded-2xl border border-wood-200 bg-wood-50 px-4 py-3">
          <MaterialCommunityIcons name="information-outline" size={18} color="#9A763C" />
          <Text className="ml-2 flex-1 text-xs leading-5 text-wood-600">
            若獵人抵達後<Text className="font-bold">未擊殺或目標跑掉</Text>，將統一收取{' '}
            <Text className="font-bold">${CHASE_FEE} 元車馬費</Text>，不另收服務費。
          </Text>
        </View>

        {/* 加購 */}
        <Text className="mb-3 mt-6 text-base font-black text-ink">要不要順便加購？</Text>
        {ADDONS.map((a) => {
          const on = addonIds.includes(a.id);
          return (
            <Pressable key={a.id} onPress={() => toggleAddon(a.id)} className="mb-3">
              <View
                className={`flex-row items-center rounded-3xl border-2 px-4 py-3 ${
                  on ? 'border-leaf bg-leaf/10' : 'border-wood-100 bg-white'
                }`}
                style={on ? undefined : cardShadow}
              >
                <View
                  className={`h-6 w-6 items-center justify-center rounded-md border-2 ${
                    on ? 'border-leaf bg-leaf' : 'border-wood-200 bg-white'
                  }`}
                >
                  {on && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-sm font-bold text-ink">{a.label}</Text>
                  <Text className="text-xs text-mute">{a.desc}</Text>
                </View>
                <Text className="text-sm font-black text-ink">+${a.price}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 底部結算列 */}
      <View className="border-t border-wood-100 bg-white px-5 pb-6 pt-3" style={cardShadow}>
        <View className="mb-2 flex-row items-end justify-between">
          <Text className="text-xs text-mute">指導價（實際以結案為準）</Text>
          <Text className="text-2xl font-black text-ink">
            ${total}
            <Text className="text-sm font-semibold text-mute"> 起</Text>
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/status')}
          style={({ pressed }) => [
            {
              shadowColor: '#E2553A',
              shadowOpacity: 0.4,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 8,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          <View className="flex-row items-center justify-center rounded-[24px] bg-sos py-4">
            <Ionicons name="flash" size={20} color="#FFFFFF" />
            <Text className="ml-2 text-lg font-black text-white">確認呼救・開始媒合</Text>
          </View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
