import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MosaicTarget } from '@/components/mosaic-target';
import {
  ADDONS,
  BRAND,
  ESCAPE_FEE,
  HUNTER_LEVELS,
  TARGET_TIERS,
  TOOL_PREP_FEE,
  type HunterLevelId,
  type TargetTier,
} from '@/constants/brand';
import { shadowSoft, shadowSos } from '@/constants/shadows';
import { isValidLatLng } from '@/lib/geo';
import { createOrder, type GenderPref } from '@/lib/orders';
import { fetchProfile } from '@/lib/profiles';
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
  const [needsTools, setNeedsTools] = useState(false); // 是否請獵人自備工具（+$35）
  const [exactAddress, setExactAddress] = useState('');
  const [entryInstructions, setEntryInstructions] = useState('');

  const tier = TARGET_TIERS.find((t) => t.id === tierId)!;
  const level = HUNTER_LEVELS.find((l) => l.id === levelId)!;
  const addonTotal = ADDONS.filter((a) => addonIds.includes(a.id)).reduce((s, a) => s + a.price, 0);
  const toolFee = needsTools ? TOOL_PREP_FEE : 0;
  // 動態總價：基礎(大小) + 加購 + 等級加價 + 工具費
  const total = tier.price + addonTotal + level.surcharge + toolFee;

  const toggleAddon = (id: string) =>
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const startMatching = useAppStore((s) => s.startMatching);
  const setOrderId = useAppStore((s) => s.setOrderId);
  const userId = useAppStore((s) => s.userId);
  const userLocation = useAppStore((s) => s.userLocation);
  const [submitting, setSubmitting] = useState(false);
  const [showPayment, setShowPayment] = useState(false); // 模擬付款過場

  // 讀取求救者預存的「地址基底」（模糊地址），發單時當底稿降低輸入摩擦
  const [baseLocation, setBaseLocation] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchProfile(userId).then((p) => active && setBaseLocation(p?.default_location_name ?? null));
    return () => {
      active = false;
    };
  }, [userId]);
  const hasBase = !!baseLocation;

  const canSubmit = exactAddress.trim().length > 0;
  // 完整地址 = 模糊基底 + 精確門牌；沒設基底時就用使用者輸入的完整地址
  const composedAddress = hasBase ? `${baseLocation} ${exactAddress.trim()}` : exactAddress.trim();

  // 按「確認呼救」：先驗證地址，再開啟模擬付款過場（先付款後派單）
  const onPressSubmit = () => {
    if (!canSubmit) {
      Alert.alert('還差一步', '請先填寫精確門牌地址（媒合成功前不會公開給任何獵人）');
      return;
    }
    setShowPayment(true);
  };

  // 確認支付後才真正寫入 Supabase 並進雷達頁。
  // try/finally 確保任何失敗（含網路丟例外）都會解鎖按鈕，不會卡在「送出中」。
  const payAndCreate = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // 定位無效（缺失 / (0,0) 哨兵值）就寫 null，避免污染 DB、讓獵人端算出極端距離
      const coords = isValidLatLng(userLocation) ? userLocation : null;
      const { id, error } = await createOrder({
        clientId: userId,
        tierId,
        price: total,
        lat: coords?.latitude ?? null,
        lng: coords?.longitude ?? null,
        genderPref,
        minCompleted: level.minCompleted,
        needsTools,
        exactAddress: composedAddress,
        entryInstructions: entryInstructions.trim() || null,
      });
      if (error) {
        Alert.alert('付款或建立訂單失敗', error);
        return;
      }
      setShowPayment(false);
      startMatching({ tierId, addonIds, total });
      setOrderId(id);
      router.push('/matching');
    } catch (e) {
      Alert.alert('付款失敗', e instanceof Error ? e.message : '請稍後再試');
    } finally {
      setSubmitting(false);
    }
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
        {/* 地址基底（讀自個人設定的模糊地址）*/}
        <Pressable
          onPress={() => router.push('/client/profile')}
          accessibilityRole="button"
          accessibilityLabel="編輯地址基底"
          className="mb-5 mt-2 flex-row items-center rounded-3xl bg-cream px-4 py-3"
          style={shadowSoft}
        >
          <View className="h-9 w-9 items-center justify-center rounded-full bg-wood-300">
            <Ionicons name="location" size={18} color="#FFFFFF" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-[11px] text-mute">地址基底（模糊地址・可在個人設定修改）</Text>
            <Text className={`text-sm font-bold ${hasBase ? 'text-ink' : 'text-mute'}`}>
              {hasBase ? baseLocation : '尚未設定，點此前往設定'}
            </Text>
          </View>
          <View className="flex-row items-center">
            <Ionicons name="create-outline" size={14} color="#9A763C" />
            <Text className="ml-1 text-xs font-semibold text-wood-600">編輯</Text>
          </View>
        </Pressable>

        {/* 精確地址（必填）+ 進入指引（選填）*/}
        <Text className="mb-2 text-base font-black text-ink">{hasBase ? '補上精確門牌' : '確認精確地址'}</Text>
        <View className="mb-2.5 rounded-2xl border-2 border-wood-100 bg-white px-4 py-3" style={shadowSoft}>
          <Text className="text-[11px] text-mute">
            {hasBase ? '門牌・樓層（必填，獵人接單後才看得到）' : '完整地址（必填，獵人接單後才看得到）'}
          </Text>
          <TextInput
            value={exactAddress}
            onChangeText={setExactAddress}
            placeholder={hasBase ? '例如：100 號 3 樓之 2' : '例如：夏日路 100 號 3 樓'}
            placeholderTextColor="#C4BCB0"
            accessibilityLabel="精確門牌地址，必填"
            className="mt-1 text-base font-bold text-ink"
          />
          {hasBase && exactAddress.trim().length > 0 && (
            <Text className="mt-1.5 text-[11px] text-leaf">完整地址：{composedAddress}</Text>
          )}
        </View>
        <View className="mb-2.5 rounded-2xl border border-wood-100 bg-white px-4 py-3">
          <Text className="text-[11px] text-mute">進入指引（選填，給警衛 / 大門）</Text>
          <TextInput
            value={entryInstructions}
            onChangeText={setEntryInstructions}
            placeholder="例如：按 3 樓電鈴，或跟管理員說找王小姐"
            placeholderTextColor="#C4BCB0"
            accessibilityLabel="進入指引，選填"
            multiline
            className="mt-1 text-sm text-ink"
          />
        </View>
        <View className="mb-6 flex-row items-center rounded-xl bg-leaf/10 px-3 py-2">
          <Ionicons name="lock-closed" size={13} color="#7FB069" />
          <Text className="ml-1.5 flex-1 text-[11px] text-leaf">
            隱私保護：媒合成功前，精確地址不會公開給任何獵人
          </Text>
        </View>

        {/* 現場狀況 */}
        <Text className="mb-3 text-base font-black text-ink">那個・長怎樣？</Text>
        {TARGET_TIERS.map((t) => (
          <TierCard key={t.id} tier={t} selected={t.id === tierId} onPress={() => setTierId(t.id)} />
        ))}

        {/* 撲空車馬費備註 */}
        <View className="mt-1 flex-row items-start rounded-2xl border border-wood-200 bg-wood-50 px-4 py-3">
          <MaterialCommunityIcons name="information-outline" size={18} color="#9A763C" />
          <Text className="ml-2 flex-1 text-xs leading-5 text-wood-600">
            若獵人抵達後<Text className="font-bold">目標已逃逸</Text>，僅收取{' '}
            <Text className="font-bold">${ESCAPE_FEE} 元車馬費</Text>，預付金額的差額會
            <Text className="font-bold">自動退成儲值金</Text>存進你的錢包。
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

        {/* 工具準備（單選）*/}
        <Text className="mb-3 mt-6 text-base font-black text-ink">是否需獵人自備工具？</Text>
        <Text className="-mt-2 mb-3 text-xs text-mute">拖鞋・殺蟲劑・塑膠袋等</Text>
        {[
          { value: false, label: '我會準備好工具', desc: '現場已備妥道具', fee: 0 },
          { value: true, label: '請獵人自備', desc: '由獵人帶齊裝備上門', fee: TOOL_PREP_FEE },
        ].map((opt) => {
          const on = needsTools === opt.value;
          return (
            <Pressable
              key={String(opt.value)}
              onPress={() => setNeedsTools(opt.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${opt.label}，加價 ${opt.fee} 元`}
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
                  <Text className="text-sm font-bold text-ink">{opt.label}</Text>
                  <Text className="text-xs text-mute">{opt.desc}</Text>
                </View>
                <Text className={`text-sm font-black ${on ? 'text-sos' : 'text-ink'}`}>
                  {opt.fee === 0 ? '+$0' : `+$${opt.fee}`}
                </Text>
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
          onPress={onPressSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={`確認呼救，需先支付 ${total} 元，開始媒合獵人`}
          style={({ pressed }) => [
            shadowSos,
            { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: !canSubmit ? 0.5 : 1 },
          ]}
        >
          <View className="flex-row items-center justify-center rounded-[24px] bg-sos py-4">
            <Ionicons name={canSubmit ? 'card' : 'create-outline'} size={20} color="#FFFFFF" />
            <Text className="ml-2 text-lg font-black text-white">
              {canSubmit ? '確認呼救・前往付款' : '請先填寫精確地址'}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* 模擬付款過場（先付款後派單）*/}
      <Modal
        visible={showPayment}
        transparent
        animationType="slide"
        onRequestClose={() => !submitting && setShowPayment(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <Pressable
            className="flex-1"
            accessibilityRole="button"
            accessibilityLabel="關閉付款"
            onPress={() => !submitting && setShowPayment(false)}
          />
          <View className="rounded-t-[28px] bg-paper px-5 pb-8 pt-4" style={shadowSoft}>
            <View className="mb-4 h-1.5 w-12 self-center rounded-full bg-wood-200" />
            <Text className="text-xl font-black text-ink">確認支付</Text>
            <Text className="mt-1 text-xs text-mute">先付款後派單，避免私下交易糾紛</Text>

            {/* 模擬信用卡 */}
            <View className="mt-4 rounded-3xl bg-ink p-5" style={shadowSoft}>
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-semibold tracking-widest text-silver">VISA・模擬卡</Text>
                <Ionicons name="card" size={20} color="#C3C9D2" />
              </View>
              <Text className="mt-4 text-lg font-black tracking-[3px] text-white">
                •••• •••• •••• 4242
              </Text>
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-[11px] text-silver">{BRAND.requesterTitle}</Text>
                <Text className="text-[11px] text-silver">12 / 28</Text>
              </View>
            </View>

            {/* 明細 */}
            <View className="mt-4 rounded-2xl bg-white p-4" style={shadowSoft}>
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-mute">應付總額</Text>
                <Text className="text-2xl font-black text-ink">${total}</Text>
              </View>
              <Text className="mt-1 text-[11px] text-mute">
                含現場狀況 ${tier.price}・加購 ${addonTotal}・等級 ${level.surcharge}・工具 ${toolFee}
              </Text>
            </View>

            <Pressable
              onPress={payAndCreate}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={`確認支付 ${total} 元`}
              className="mt-5"
              style={({ pressed }) => [
                shadowSos,
                { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: submitting ? 0.6 : 1 },
              ]}
            >
              <View className="flex-row items-center justify-center rounded-[24px] bg-sos py-4">
                <Ionicons name="lock-closed" size={18} color="#FFFFFF" />
                <Text className="ml-2 text-lg font-black text-white">
                  {submitting ? '處理付款中…' : `確認支付 $${total} 元`}
                </Text>
              </View>
            </Pressable>
            <Text className="mt-2 text-center text-[11px] text-mute">模擬金流・不會真實扣款</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
