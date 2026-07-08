import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LevelBadge } from '@/components/level-badge';
import { CANCEL_PENALTY, ESCAPE_FEE, TARGET_TIERS, levelFromCompleted } from '@/constants/brand';
import { shadowSoft } from '@/constants/shadows';
import { PLATFORM_FEE_RATE, netEarning } from '@/data/tasks';
import { successHaptic } from '@/lib/haptics';
import {
  fetchMyRating,
  fetchOrder,
  fetchOrderPrivate,
  submitRating,
  tierIdFromSize,
  type OrderPrivate,
  type OrderRow,
  type OrderStatusDb,
} from '@/lib/orders';
import { fetchProfile, type Profile } from '@/lib/profiles';
import { fetchWalletTransactions, WALLET_KIND_LABEL, type WalletTx } from '@/lib/wallet';
import { useAppStore } from '@/store/useAppStore';

const STATUS_META: Record<OrderStatusDb, { label: string; badge: string; text: string }> = {
  searching: { label: '媒合中', badge: 'bg-sos/10', text: 'text-sos' },
  matched: { label: '進行中', badge: 'bg-sos/10', text: 'text-sos' },
  verifying: { label: '待確認', badge: 'bg-leaf/15', text: 'text-leaf' },
  completed: { label: '已完成', badge: 'bg-leaf/15', text: 'text-leaf' },
  escaped: { label: '目標逃逸', badge: 'bg-wood-100', text: 'text-wood-600' },
  cancelled: { label: '已取消', badge: 'bg-wood-50', text: 'text-mute' },
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className="text-xs text-mute">{label}</Text>
      <Text className={`text-sm ${strong ? 'font-black text-ink' : 'font-semibold text-ink'}`}>
        {value}
      </Text>
    </View>
  );
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAppStore((s) => s.userId);

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [peer, setPeer] = useState<Profile | null>(null);
  const [priv, setPriv] = useState<OrderPrivate | null>(null);
  const [txs, setTxs] = useState<WalletTx[]>([]);
  const [myStars, setMyStars] = useState<number | null>(null);
  const [draftStars, setDraftStars] = useState(5);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const o = await fetchOrder(id);
      if (!active) return;
      setOrder(o);
      if (o) {
        const peerId = o.hunter_id === userId ? o.client_id : o.hunter_id;
        const [p, pv, mine, tx] = await Promise.all([
          peerId ? fetchProfile(peerId) : Promise.resolve(null),
          fetchOrderPrivate(id), // RLS：非當事人 / 已清除 → null
          fetchMyRating(id, userId),
          fetchWalletTransactions(userId),
        ]);
        if (!active) return;
        setPeer(p);
        setPriv(pv);
        setMyStars(mine);
        if (mine) setDraftStars(mine);
        setTxs(tx.filter((t) => t.order_id === id));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id, userId]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#FB6B4B" />
        <Text className="mt-3 text-xs text-mute">載入訂單…</Text>
      </SafeAreaView>
    );
  }
  if (!order) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper px-8">
        <MaterialCommunityIcons name="file-remove-outline" size={40} color="#C4BCB0" />
        <Text className="mt-3 text-sm font-bold text-ink">找不到這張訂單</Text>
        <Pressable onPress={() => router.back()} className="mt-4 rounded-full bg-cream px-5 py-2">
          <Text className="text-sm font-bold text-ink">返回</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const asHunter = order.hunter_id === userId;
  const meta = STATUS_META[order.status];
  const tier = TARGET_TIERS.find((t) => t.id === tierIdFromSize(order.target_size))!;
  const price = order.price ?? 0;
  const peerId = asHunter ? order.client_id : order.hunter_id;
  const peerName = peer?.display_name ?? (asHunter ? '求救者' : '獵人');
  const penaltyCancel =
    order.status === 'cancelled' && order.cancel_reason === 'client_cancelled_matched';

  // 我方金額（與歷史頁一致的視角邏輯）
  const myAmount =
    order.status === 'escaped'
      ? ESCAPE_FEE
      : penaltyCancel
        ? CANCEL_PENALTY
        : order.status === 'cancelled'
          ? 0
          : asHunter
            ? netEarning(price)
            : price;
  const amountLabel =
    order.status === 'escaped'
      ? '車馬費'
      : penaltyCancel
        ? '出勤補償'
        : order.status === 'cancelled'
          ? '已取消'
          : asHunter
            ? '淨收益'
            : '花費';

  const canRate = order.status === 'completed' && !!peerId && !!userId;

  const submit = async () => {
    if (!peerId || rating) return;
    setRating(true);
    const { error } = await submitRating(order.id, peerId, draftStars);
    setRating(false);
    if (error) {
      Alert.alert('評價失敗', error);
      return;
    }
    successHaptic();
    setMyStars(draftStars);
    Alert.alert('已送出評價', `你給了 ${peerName} ${draftStars} 顆星。`);
  };

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      <View className="flex-row items-center px-4 pb-2 pt-1">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          className="h-10 w-10 items-center justify-center rounded-full bg-cream"
        >
          <Ionicons name="chevron-back" size={22} color="#2A2521" />
        </Pressable>
        <Text className="ml-3 text-xl font-black text-ink">訂單詳情</Text>
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 狀態 + 身分 */}
        <View className="mt-2 flex-row items-center justify-between">
          <View className={`rounded-full px-2.5 py-1 ${asHunter ? 'bg-leaf/15' : 'bg-sos/10'}`}>
            <Text className={`text-[11px] font-black ${asHunter ? 'text-leaf' : 'text-sos'}`}>
              {asHunter ? '我是獵人' : '我是求救者'}
            </Text>
          </View>
          <View className={`rounded-full px-2.5 py-1 ${meta.badge}`}>
            <Text className={`text-[11px] font-bold ${meta.text}`}>{meta.label}</Text>
          </View>
        </View>

        {/* 目標 + 對方 */}
        <View className="mt-3 rounded-3xl bg-white p-4" style={shadowSoft}>
          <View className="flex-row items-center">
            <Text className="text-base font-black text-ink">{tier.label}的目標</Text>
            {order.is_vip && (
              <MaterialCommunityIcons
                name="crown"
                size={15}
                color="#E6B422"
                style={{ marginLeft: 6 }}
              />
            )}
          </View>
          <Text className="mt-0.5 text-xs text-mute">{tier.hint}</Text>

          <View className="my-3 h-px bg-wood-100" />

          <View className="flex-row items-center">
            <View className="h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-wood-300">
              {peer?.avatar_url ? (
                <Image source={{ uri: peer.avatar_url }} style={{ width: 44, height: 44 }} />
              ) : (
                <Ionicons name={asHunter ? 'home' : 'walk'} size={18} color="#FFFFFF" />
              )}
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-sm font-bold text-ink">
                {asHunter ? '求救者' : '獵人'}：{peerName}
              </Text>
              {peer != null && (
                <View className="mt-0.5 flex-row items-center">
                  <Ionicons name="star" size={12} color="#F5A623" />
                  <Text className="ml-1 text-xs font-bold text-ink">{peer.rating.toFixed(1)}</Text>
                  {asHunter ? null : (
                    <View className="ml-2">
                      <LevelBadge level={levelFromCompleted(peer.completed_tasks)} />
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>

        {/* 金流明細 */}
        <Text className="mb-2 mt-6 text-base font-black text-ink">金流明細</Text>
        <View className="rounded-3xl bg-white p-4" style={shadowSoft}>
          <Row label="訂單金額" value={`$${price}`} />
          {asHunter && order.status !== 'cancelled' && order.status !== 'escaped' && (
            <Row
              label={`平台抽成 ${Math.round(PLATFORM_FEE_RATE * 100)}%`}
              value={`- $${price - netEarning(price)}`}
            />
          )}
          <View className="my-2 h-px bg-wood-100" />
          <Row
            label={`我方${amountLabel}`}
            value={`${asHunter ? '+' : order.status === 'cancelled' && !penaltyCancel ? '' : '-'}$${myAmount}`}
            strong
          />

          {/* 這張單相關的儲值金帳目 */}
          {txs.length > 0 && (
            <>
              <View className="my-2 h-px bg-wood-100" />
              <Text className="mb-1 mt-1 text-[11px] font-bold text-mute">儲值金異動</Text>
              {txs.map((t) => (
                <View key={t.id} className="flex-row items-center justify-between py-1">
                  <Text className="text-xs text-mute">{t.memo ?? WALLET_KIND_LABEL[t.kind]}</Text>
                  <Text className="text-sm font-bold text-leaf">+${t.amount}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* 地址（當事人 + 尚未清除時）*/}
        {priv?.exact_address && (
          <>
            <Text className="mb-2 mt-6 text-base font-black text-ink">地點</Text>
            <View className="rounded-3xl bg-white p-4" style={shadowSoft}>
              <View className="flex-row items-start">
                <Ionicons name="location" size={16} color="#9A763C" />
                <Text className="ml-2 flex-1 text-sm text-ink">{priv.exact_address}</Text>
              </View>
              {priv.entry_instructions ? (
                <View className="mt-2 flex-row items-start rounded-2xl bg-cream px-3 py-2">
                  <Ionicons name="enter-outline" size={15} color="#9A763C" />
                  <Text className="ml-2 flex-1 text-xs text-ink">{priv.entry_instructions}</Text>
                </View>
              ) : null}
            </View>
          </>
        )}

        {/* 時間 */}
        <Text className="mb-2 mt-6 text-base font-black text-ink">時間軸</Text>
        <View className="rounded-3xl bg-white p-4" style={shadowSoft}>
          <Row label="建立時間" value={formatDateTime(order.created_at)} />
          {order.cancel_reason && (
            <Row
              label="取消類型"
              value={penaltyCancel ? '已出發後取消（收補償）' : '媒合前取消（免費）'}
            />
          )}
        </View>

        {/* 評價對方（完成單、當事人）*/}
        {canRate && (
          <>
            <Text className="mb-2 mt-6 text-base font-black text-ink">
              {myStars ? '你的評價' : `評價 ${peerName}`}
            </Text>
            <View className="rounded-3xl bg-white p-4" style={shadowSoft}>
              <View className="flex-row items-center justify-center">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setDraftStars(n)}
                    accessibilityRole="button"
                    accessibilityLabel={`給 ${n} 顆星`}
                    className="px-1.5"
                  >
                    <Ionicons
                      name={n <= draftStars ? 'star' : 'star-outline'}
                      size={32}
                      color="#F5A623"
                    />
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={submit}
                disabled={rating}
                accessibilityRole="button"
                accessibilityLabel={myStars ? '更新評價' : '送出評價'}
                className="mt-4"
                style={({ pressed }) => [
                  { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: rating ? 0.6 : 1 },
                ]}
              >
                <View className="items-center rounded-2xl bg-sos py-3">
                  <Text className="text-sm font-black text-white">
                    {rating ? '送出中…' : myStars ? '更新評價' : '送出評價'}
                  </Text>
                </View>
              </Pressable>
              {myStars ? (
                <Text className="mt-2 text-center text-[11px] text-mute">
                  你已給過 {myStars}★，可隨時調整。
                </Text>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
