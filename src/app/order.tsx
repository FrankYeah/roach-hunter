import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MosaicTarget } from '@/components/mosaic-target';
import {
  ADDONS,
  BRAND,
  CHASE_FEE,
  HUNTER_LEVELS,
  TARGET_TIERS,
  type HunterLevelId,
  type TargetTier,
} from '@/constants/brand';
import { shadowSoft, shadowSos } from '@/constants/shadows';
import { CURRENT_USER } from '@/data/hunters';
import { isValidLatLng } from '@/lib/geo';
import { createOrder, type GenderPref } from '@/lib/orders';
import { useAppStore } from '@/store/useAppStore';

const GENDER_OPTIONS: { id: GenderPref; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'any', label: '不拘', icon: 'people-outline' },
  { id: 'male', label: '限男性', icon: 'male' },
  { id: 'female', label: '限女性', icon: 'female' },
];

/** 等級要求的說明文案 */
function levelHint(minCompleted: number): string {
  return minCompleted === 0 ? '新手或不拘・接受 0 次經驗' : `需累積 ${minCompleted} 次以上任務`;
}

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
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${tier.label}，${tier.hint}，指導價 ${tier.price} 元`}
      className="mb-3"
    >
      <View
        className={`flex-row items-center rounded-3xl border-2 px-4 py-4 ${
          selected ? 'border-sos bg-sos/10' : 'border-wood-100 bg-white'
        }`}
        style={selected ? undefined : shadowSoft}
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
  const [genderPref, setGenderPref] = useState<GenderPref>('any');
  const [levelId, setLevelId] = useState<HunterLevelId>('rookie');

  const tier = TARGET_TIERS.find((t) => t.id === tierId)!;
  const level = HUNTER_LEVELS.find((l) => l.id === levelId)!;
  const addonTotal = ADDONS.filter((a) => addonIds.includes(a.id)).reduce((s, a) => s + a.price, 0);
  // 動態總價：基礎(大小) + 加購 + 等級加價
  const total = tier.price + addonTotal + level.surcharge;

  const toggleAddon = (id: string) =>
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const startMatching = useAppStore((s) => s.startMatching);
  const setOrderId = useAppStore((s) => s.setOrderId);
  const userId = useAppStore((s) => s.userId);
  const userLocation = useAppStore((s) => s.userLocation);
  const [submitting, setSubmitting] = useState(false);

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    // 定位無效（缺失 / (0,0) 哨兵值）就寫 null，避免污染 DB、讓獵人端算出極端距離
    const coords = isValidLatLng(userLocation) ? userLocation : null;
    // 先真實寫入 Supabase（成功才進雷達頁，確保 orderId 已就緒）
    const { id, error } = await createOrder({
      clientId: userId,
      tierId,
      price: total,
      lat: coords?.latitude ?? null,
      lng: coords?.longitude ?? null,
      genderPref,
      minCompleted: level.minCompleted,
    });
    setSubmitting(false);
    if (error) {
      Alert.alert('呼救失敗', error);
      return;
    }
    startMatching({ tierId, addonIds, total });
    setOrderId(id);
    router.push('/matching');
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
          <Text className="text-xl font-black text-ink">{BRAND.sosLabel}</Text>
          <Text className="text-xs text-mute">選擇現場狀況，馬上幫你媒合獵人</Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {/* 地點 */}
        <View className="mb-5 mt-2 flex-row items-center rounded-3xl bg-cream px-4 py-3" style={shadowSoft}>
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
            <Pressable
              key={a.id}
              onPress={() => toggleAddon(a.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`加購 ${a.label}，${a.price} 元`}
              className="mb-3"
            >
              <View
                className={`flex-row items-center rounded-3xl border-2 px-4 py-3 ${
                  on ? 'border-leaf bg-leaf/10' : 'border-wood-100 bg-white'
                }`}
                style={on ? undefined : shadowSoft}
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

        {/* 進階篩選 */}
        <View className="mb-3 mt-7 flex-row items-center">
          <Ionicons name="options-outline" size={18} color="#2A2521" />
          <Text className="ml-2 text-base font-black text-ink">進階篩選</Text>
        </View>

        {/* 性別偏好（皆不加價）*/}
        <Text className="mb-2 text-xs font-semibold text-mute">獵人性別偏好</Text>
        <View className="mb-5 flex-row">
          {GENDER_OPTIONS.map((g) => {
            const on = genderPref === g.id;
            return (
              <Pressable
                key={g.id}
                onPress={() => setGenderPref(g.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`性別偏好 ${g.label}`}
                className="mr-2"
              >
                <View
                  className={`flex-row items-center rounded-full border px-3.5 py-2 ${
                    on ? 'border-sos bg-sos/10' : 'border-wood-200 bg-white'
                  }`}
                >
                  <Ionicons name={g.icon} size={14} color={on ? '#FB6B4B' : '#9A8F80'} />
                  <Text className={`ml-1.5 text-xs font-bold ${on ? 'text-sos' : 'text-ink'}`}>{g.label}</Text>
                  <Text className={`ml-1.5 text-[10px] ${on ? 'text-sos' : 'text-mute'}`}>+$0</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* 獵人等級要求（動態加價）*/}
        <Text className="mb-2 text-xs font-semibold text-mute">獵人等級要求</Text>
        {HUNTER_LEVELS.map((l) => {
          const on = levelId === l.id;
          return (
            <Pressable
              key={l.id}
              onPress={() => setLevelId(l.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`等級要求 ${l.name}，加價 ${l.surcharge} 元`}
              className="mb-2.5"
            >
              <View
                className={`flex-row items-center rounded-2xl border-2 px-4 py-3 ${
                  on ? 'border-sos bg-sos/10' : 'border-wood-100 bg-white'
                }`}
                style={on ? undefined : shadowSoft}
              >
                <View
                  className={`h-6 w-6 items-center justify-center rounded-full ${on ? 'bg-sos' : 'bg-wood-100'}`}
                >
                  {on && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-sm font-bold text-ink">{l.name}</Text>
                  <Text className="text-xs text-mute">{levelHint(l.minCompleted)}</Text>
                </View>
                <Text className={`text-sm font-black ${on ? 'text-sos' : 'text-ink'}`}>
                  {l.surcharge === 0 ? '+$0' : `+$${l.surcharge}`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 底部結算列 */}
      <View className="border-t border-wood-100 bg-white px-5 pb-6 pt-3" style={shadowSoft}>
        <View className="mb-2 flex-row items-end justify-between">
          <Text className="text-xs text-mute">指導價（實際以結案為準）</Text>
          <Text className="text-2xl font-black text-ink">
            ${total}
            <Text className="text-sm font-semibold text-mute"> 起</Text>
          </Text>
        </View>
        <Pressable
          onPress={confirm}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={`確認呼救，指導價 ${total} 元起，開始媒合獵人`}
          style={({ pressed }) => [
            shadowSos,
            { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: submitting ? 0.6 : 1 },
          ]}
        >
          <View className="flex-row items-center justify-center rounded-[24px] bg-sos py-4">
            <Ionicons name="flash" size={20} color="#FFFFFF" />
            <Text className="ml-2 text-lg font-black text-white">
              {submitting ? '送出中…' : '確認呼救・開始媒合'}
            </Text>
          </View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
