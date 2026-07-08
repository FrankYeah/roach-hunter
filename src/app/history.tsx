import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CANCEL_PENALTY, ESCAPE_FEE, TARGET_TIERS } from '@/constants/brand';
import { shadowSoft } from '@/constants/shadows';
import { netEarning } from '@/data/tasks';
import { fetchMyOrders, tierIdFromSize, type OrderRow, type OrderStatusDb } from '@/lib/orders';
import { fetchProfile, fetchProfilesMap, type Profile } from '@/lib/profiles';
import { fetchWalletTransactions, WALLET_KIND_LABEL, type WalletTx } from '@/lib/wallet';
import { useAppStore } from '@/store/useAppStore';

/** 訂單狀態 → 中文標籤 + 配色（淺木質調）*/
const STATUS_META: Record<OrderStatusDb, { label: string; badge: string; text: string }> = {
  searching: { label: '媒合中', badge: 'bg-sos/10', text: 'text-sos' },
  matched: { label: '進行中', badge: 'bg-sos/10', text: 'text-sos' },
  verifying: { label: '待確認', badge: 'bg-leaf/15', text: 'text-leaf' },
  completed: { label: '已完成', badge: 'bg-leaf/15', text: 'text-leaf' },
  escaped: { label: '目標逃逸', badge: 'bg-wood-100', text: 'text-wood-600' },
  cancelled: { label: '已取消', badge: 'bg-wood-50', text: 'text-mute' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}`;
}

function sizeLabel(size: OrderRow['target_size']): string {
  return TARGET_TIERS.find((t) => t.id === tierIdFromSize(size))?.label ?? size;
}

export default function HistoryScreen() {
  const userId = useAppStore((s) => s.userId);

  const [me, setMe] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [names, setNames] = useState<Record<string, Profile>>({});
  const [walletTx, setWalletTx] = useState<WalletTx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      const [p, os, tx] = await Promise.all([
        fetchProfile(userId),
        fetchMyOrders(userId),
        fetchWalletTransactions(userId),
      ]);
      if (!active) return;
      setMe(p);
      setOrders(os);
      setWalletTx(tx);
      // 撈出每筆訂單「對方」的名字（我是 client → 對方是 hunter，反之亦然）
      const map = await fetchProfilesMap(
        os.map((o) => (o.client_id === userId ? o.hunter_id : o.client_id)),
      );
      if (active) {
        setNames(map);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  // 儲值金帳本：直接讀 wallet_transactions（DB 端結算時逐筆寫入），
  // 逐筆對帳、不再由前端從訂單狀態推導 → 金流永遠與真實餘額一致。
  const walletEntries = walletTx.map((t) => ({
    id: t.id,
    label: t.memo ?? WALLET_KIND_LABEL[t.kind] ?? '儲值金異動',
    sub: WALLET_KIND_LABEL[t.kind] ?? '儲值金',
    amount: t.amount,
    date: t.created_at,
  }));

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
        <Text className="ml-3 text-xl font-black text-ink">歷史紀錄與錢包</Text>
      </View>

      {loading ? (
        <View className="mt-20 items-center">
          <ActivityIndicator color="#FB6B4B" />
          <Text className="mt-3 text-xs text-mute">載入歷史紀錄…</Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-5"
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 錢包餘額 */}
          <View className="mt-2 flex-row items-center rounded-3xl bg-ink p-4" style={shadowSoft}>
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <MaterialCommunityIcons name="wallet-outline" size={24} color="#FFFFFF" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-xs text-silver">儲值金錢包</Text>
              <Text className="text-2xl font-black text-white">${me?.wallet_balance ?? 0}</Text>
            </View>
            <Text className="text-[11px] text-silver">可折抵未來訂單</Text>
          </View>

          {/* 錢包異動明細 */}
          <Text className="mb-2 mt-6 text-base font-black text-ink">錢包異動明細</Text>
          {walletEntries.length === 0 ? (
            <View
              className="rounded-2xl border border-wood-100 bg-white px-4 py-5"
              style={shadowSoft}
            >
              <Text className="text-center text-xs text-mute">目前沒有任何儲值金異動</Text>
            </View>
          ) : (
            walletEntries.map((e) => (
              <View
                key={e.id}
                className="mb-2.5 flex-row items-center rounded-2xl bg-white px-4 py-3"
                style={shadowSoft}
              >
                <View className="h-10 w-10 items-center justify-center rounded-full bg-leaf/15">
                  <MaterialCommunityIcons name="cash-plus" size={20} color="#7FB069" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-sm font-bold text-ink">{e.label}</Text>
                  <Text className="text-[11px] text-mute">
                    {e.sub}・{formatDate(e.date)}
                  </Text>
                </View>
                <Text className="text-base font-black text-leaf">+${e.amount}</Text>
              </View>
            ))
          )}

          {/* 歷史訂單 */}
          <Text className="mb-2 mt-7 text-base font-black text-ink">歷史訂單</Text>
          {orders.length === 0 ? (
            <View className="mt-4 items-center rounded-3xl bg-white px-4 py-10" style={shadowSoft}>
              <MaterialCommunityIcons name="clipboard-text-outline" size={36} color="#C4BCB0" />
              <Text className="mt-3 text-sm font-bold text-ink">還沒有任何訂單</Text>
              <Text className="mt-1 text-xs text-mute">呼救或接單後，紀錄會出現在這裡</Text>
            </View>
          ) : (
            orders.map((o) => {
              // 視角優先序：我是這張單的 hunter → 收入視角（正數，扣 15% 平台費後）；
              // 否則才是求救者的扣款視角（負數）。撲空一律 $150 車馬費。
              const asHunter = o.hunter_id === userId;
              const meta = STATUS_META[o.status];
              const cpId = asHunter ? o.client_id : o.hunter_id;
              const cpName = cpId
                ? (names[cpId]?.display_name ?? '對方')
                : asHunter
                  ? '求救者'
                  : '尚未媒合';
              const price = o.price ?? 0;
              // 中途取消（已媒合）：獵人賺到 $100 出勤補償、求救者付了 $100；
              // 免費取消（媒合前）則雙方都是 $0。
              const penaltyCancel =
                o.status === 'cancelled' && o.cancel_reason === 'client_cancelled_matched';
              const earned =
                o.status === 'escaped'
                  ? ESCAPE_FEE
                  : penaltyCancel
                    ? CANCEL_PENALTY
                    : o.status === 'cancelled'
                      ? 0
                      : netEarning(price);
              const spent =
                o.status === 'escaped'
                  ? ESCAPE_FEE
                  : penaltyCancel
                    ? CANCEL_PENALTY
                    : o.status === 'cancelled'
                      ? 0
                      : price;
              const amountTag =
                o.status === 'escaped'
                  ? '車馬費'
                  : penaltyCancel
                    ? '出勤補償'
                    : o.status === 'cancelled'
                      ? '已取消'
                      : asHunter
                        ? '淨收益'
                        : '花費';
              return (
                <View key={o.id} className="mb-3 rounded-3xl bg-white p-4" style={shadowSoft}>
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center">
                      {/* 身分標籤：出動（獵人）/ 求救（求救者）*/}
                      <View
                        className={`rounded-full px-2 py-0.5 ${asHunter ? 'bg-leaf/15' : 'bg-sos/10'}`}
                      >
                        <Text
                          className={`text-[11px] font-black ${asHunter ? 'text-leaf' : 'text-sos'}`}
                        >
                          {asHunter ? '出動' : '求救'}
                        </Text>
                      </View>
                      <Text className="ml-2 text-[11px] text-mute">{formatDate(o.created_at)}</Text>
                      {o.is_vip && (
                        <MaterialCommunityIcons
                          name="crown"
                          size={13}
                          color="#E6B422"
                          style={{ marginLeft: 4 }}
                        />
                      )}
                    </View>
                    {/* 狀態徽章 */}
                    <View className={`rounded-full px-2.5 py-1 ${meta.badge}`}>
                      <Text className={`text-[11px] font-bold ${meta.text}`}>{meta.label}</Text>
                    </View>
                  </View>

                  <View className="mt-3 flex-row items-end justify-between">
                    <View className="flex-1">
                      <Text className="text-sm font-black text-ink">
                        {sizeLabel(o.target_size)}的目標
                      </Text>
                      <View className="mt-0.5 flex-row items-center">
                        <Ionicons name={asHunter ? 'home' : 'walk'} size={11} color="#9A8F80" />
                        <Text className="ml-1 text-xs text-mute">
                          {asHunter ? '求救者' : '獵人'}：{cpName}
                        </Text>
                      </View>
                    </View>
                    <View className="items-end">
                      <Text className={`text-lg font-black ${asHunter ? 'text-leaf' : 'text-ink'}`}>
                        {asHunter ? `+$${earned}` : `-$${spent}`}
                      </Text>
                      <Text className="text-[10px] text-mute">{amountTag}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
