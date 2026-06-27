import { type RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/** 對應 SQL 的 public.messages 一列 */
export interface Message {
  id: string;
  order_id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
}

const MSG_COLS = 'id, order_id, sender_id, content, created_at';

/** 讀取某訂單的歷史訊息（舊到新）。受 RLS 保護：只有 client / hunter 讀得到。*/
export async function fetchMessages(orderId: string): Promise<Message[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data } = await supabase
    .from('messages')
    .select(MSG_COLS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  return (data as Message[] | null) ?? [];
}

/** 送出一則訊息（RLS 要求 sender 必須是自己、且為該訂單當事人）。*/
export async function sendMessage(
  orderId: string,
  senderId: string | null,
  content: string,
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured || !supabase) return { error: null };
  const { error } = await supabase
    .from('messages')
    .insert({ order_id: orderId, sender_id: senderId, content });
  return { error: error?.message ?? null };
}

// 唯一 topic：避免 removeChannel 非同步拆除未完成時，沿用同名 channel 觸發
// "cannot add postgres_changes callbacks after subscribe()"（與 orders 訂閱同理）。
let chatSeq = 0;

/** 訂閱某訂單的新訊息（INSERT），雙方即時收到。回傳取消訂閱函式。*/
export function subscribeMessages(orderId: string, onInsert: (m: Message) => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`messages:${orderId}:${++chatSeq}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${orderId}` },
      (payload: RealtimePostgresChangesPayload<Message>) => onInsert(payload.new as Message),
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}
