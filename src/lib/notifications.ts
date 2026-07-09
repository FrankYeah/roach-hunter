import { type RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/** 對應 SQL 的 public.notifications 一列 */
export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  route: string | null;
  read: boolean;
  created_at: string;
}

const COLS = 'id, user_id, title, body, route, read, created_at';

/** 讀取自己的通知（新到舊，上限 50）。受 RLS 保護：只會回自己的。*/
export async function fetchNotifications(userId: string | null): Promise<AppNotification[]> {
  if (!isSupabaseConfigured || !supabase || !userId) return [];
  const { data } = await supabase
    .from('notifications')
    .select(COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data as AppNotification[] | null) ?? [];
}

/** 未讀數量（給紅點用；head count 不撈整列）。*/
export async function fetchUnreadCount(userId: string | null): Promise<number> {
  if (!isSupabaseConfigured || !supabase || !userId) return 0;
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  return count ?? 0;
}

/** 把自己所有未讀標記為已讀（進通知中心時呼叫）。*/
export async function markAllNotificationsRead(userId: string | null): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !userId) return;
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
}

let notifSeq = 0;

/** 訂閱自己的新通知（INSERT）。回傳取消訂閱函式；未設定 Supabase 時為 no-op。*/
export function subscribeNotifications(
  userId: string | null,
  onInsert: (n: AppNotification) => void,
): () => void {
  if (!isSupabaseConfigured || !supabase || !userId) return () => {};
  const client = supabase;
  const channel = client
    .channel(`notifs:${userId}:${++notifSeq}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload: RealtimePostgresChangesPayload<AppNotification>) =>
        onInsert(payload.new as AppNotification),
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}
