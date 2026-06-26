import { type RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { type TargetTier } from '@/constants/brand';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/** DB 的 orders 一列（對應 SQL schema）*/
export interface OrderRow {
  id: string;
  client_id: string | null;
  hunter_id: string | null;
  target_size: '小' | '大' | '飛';
  status: 'searching' | 'matched' | 'completed';
  location_lat: number | null;
  location_lng: number | null;
  price: number | null;
  created_at: string;
}

/** tier id → DB target_size 短碼（對應 SQL 的 CHECK 限制）*/
const TARGET_SIZE: Record<TargetTier['id'], OrderRow['target_size']> = {
  small: '小',
  big: '大',
  flying: '飛',
};

export interface CreateOrderInput {
  clientId: string | null;
  tierId: TargetTier['id'];
  price: number;
  lat: number | null;
  lng: number | null;
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
    })
    .select('id')
    .single();
  return { id: (data?.id as string | undefined) ?? null, error: error?.message ?? null };
}

/**
 * 訂閱單一訂單的狀態更新（Supabase Realtime）。
 * 回傳取消訂閱函式；未設定 Supabase 時為 no-op。
 */
export function subscribeOrder(orderId: string, onUpdate: (row: OrderRow) => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`orders:${orderId}`)
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
