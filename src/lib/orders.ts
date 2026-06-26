import { type RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { type TargetTier } from '@/constants/brand';
import { isValidLatLng } from '@/lib/geo';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { type LatLng } from '@/store/useAppStore';

export type OrderStatusDb = 'searching' | 'matched' | 'completed' | 'cancelled';

/** DB 的 orders 一列（對應 SQL schema）*/
export interface OrderRow {
  id: string;
  client_id: string | null;
  hunter_id: string | null;
  target_size: '小' | '大' | '飛';
  status: OrderStatusDb;
  location_lat: number | null;
  location_lng: number | null;
  hunter_lat: number | null;
  hunter_lng: number | null;
  price: number | null;
  /** 求救者的進階篩選條件 */
  gender_pref: GenderPref;
  min_completed: number;
  created_at: string;
}

/** 性別偏好：不拘 / 限男性 / 限女性 */
export type GenderPref = 'any' | 'male' | 'female';

/** tier id → DB target_size 短碼（對應 SQL 的 CHECK 限制）*/
const TARGET_SIZE: Record<TargetTier['id'], OrderRow['target_size']> = {
  small: '小',
  big: '大',
  flying: '飛',
};

/** DB target_size 短碼 → tier id */
export function tierIdFromSize(size: OrderRow['target_size']): TargetTier['id'] {
  return size === '小' ? 'small' : size === '大' ? 'big' : 'flying';
}

export interface CreateOrderInput {
  clientId: string | null;
  tierId: TargetTier['id'];
  price: number;
  lat: number | null;
  lng: number | null;
  genderPref: GenderPref;
  minCompleted: number;
}

/** 建立呼救訂單並寫入 Supabase。未設定 Supabase 時回傳 null（mock 後備）。*/
export async function createOrder(
  input: CreateOrderInput,
): Promise<{ id: string | null; error: string | null }> {
  if (!isSupabaseConfigured || !supabase) return { id: null, error: null };
  const { data, error } = await supabase
    .from('orders')
    .insert({
      client_id: input.clientId,
      target_size: TARGET_SIZE[input.tierId],
      status: 'searching',
      location_lat: input.lat,
      location_lng: input.lng,
      price: input.price,
      gender_pref: input.genderPref,
      min_completed: input.minCompleted,
    })
    .select('id')
    .single();
  return { id: (data?.id as string | undefined) ?? null, error: error?.message ?? null };
}

/** 讀取單一訂單 */
export async function fetchOrder(orderId: string): Promise<OrderRow | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
  return (data as OrderRow | null) ?? null;
}

/** 任務池：讀取所有 searching 中的訂單（新到舊）*/
export async function fetchOpenOrders(): Promise<OrderRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data } = await supabase
    .from('orders')
    .select('*')
    .eq('status', 'searching')
    .order('created_at', { ascending: false });
  return (data as OrderRow[] | null) ?? [];
}

/**
 * 搶單：原子地把 searching 訂單更新為 matched 並寫入 hunter_id。
 * ok=false 代表已被別的獵人搶走（或已不是 searching）。
 */
export async function acceptOrder(
  orderId: string,
  hunterId: string,
  hunterLoc: LatLng | null,
): Promise<{ ok: boolean; error: string | null }> {
  if (!isSupabaseConfigured || !supabase) return { ok: true, error: null };
  // 1) 原子搶單：只動 status + hunter_id，這樣即使尚未跑 hunter_lat/lng 遷移也不會壞
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'matched', hunter_id: hunterId })
    .eq('id', orderId)
    .eq('status', 'searching') // 只搶仍在 searching 的單 → 避免雙搶
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: null };
  // 2) best-effort 寫入獵人座標（讓求救端能算 ETA）；欄位若未遷移就忽略錯誤
  const loc = isValidLatLng(hunterLoc) ? hunterLoc : null;
  if (loc) {
    await supabase
      .from('orders')
      .update({ hunter_lat: loc.latitude, hunter_lng: loc.longitude })
      .eq('id', orderId);
  }
  return { ok: true, error: null };
}

/** 求救者取消：把訂單標記為 cancelled */
export async function cancelOrder(orderId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
}

/** 獵人回報完成：把訂單標記為 completed */
export async function completeOrderDb(orderId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  await supabase.from('orders').update({ status: 'completed' }).eq('id', orderId);
}

/**
 * 每個訂閱都用唯一的 channel topic。
 * 原因：removeChannel() 是非同步的，若沿用固定 topic，當 effect 在
 * dev 重複掛載 / 快速切換頁面時重新訂閱，supabase-js 會回傳那個「尚未
 * 拆除完成、且已 subscribe()」的同名 channel，接著鏈上的 .on() 就會丟出
 * "cannot add postgres_changes callbacks ... after subscribe()"。
 * 唯一 topic 保證 .channel() 永遠回傳全新 channel，.on() 必在 subscribe() 前。
 */
let channelSeq = 0;

/**
 * 訂閱單一訂單的狀態更新（求救端用）。
 * 回傳取消訂閱函式；未設定 Supabase 時為 no-op。
 */
export function subscribeOrder(orderId: string, onUpdate: (row: OrderRow) => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`order:${orderId}:${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
      (payload: RealtimePostgresChangesPayload<OrderRow>) => onUpdate(payload.new as OrderRow),
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}

/**
 * 訂閱 orders 表的任何變更（任務池用）。收到事件即呼叫 onChange，
 * 由呼叫端重新抓取 open orders。回傳取消訂閱函式。
 */
export function subscribeOpenOrders(onChange: () => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`orders:pool:${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => onChange())
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}
