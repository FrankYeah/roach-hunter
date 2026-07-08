import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * 信任與安全：檢舉 / 封鎖 / 爭議申訴。
 * 三張表都以 RLS 鎖「本人相關」，這裡只包一層薄薄的呼叫，未設定 Supabase
 * 時一律靜默成功（mock demo 不阻塞）。稽核與裁決在後台用 service_role 進行。
 */

/** 檢舉某使用者（可附訂單）。reason 目前用固定分類，後台再人工判讀。*/
export async function reportUser(
  reporterId: string | null,
  reportedId: string | null,
  orderId: string | null,
  reason: string,
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured || !supabase || !reporterId || !reportedId) return { error: null };
  const { error } = await supabase.from('user_reports').insert({
    reporter_id: reporterId,
    reported_id: reportedId,
    order_id: orderId,
    reason,
  });
  return { error: error?.message ?? null };
}

/** 封鎖某使用者（之後雙方不再互相媒合）。重複封鎖靠 PK 冪等，忽略衝突錯誤。*/
export async function blockUser(
  blockerId: string | null,
  blockedId: string | null,
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured || !supabase || !blockerId || !blockedId) return { error: null };
  const { error } = await supabase
    .from('blocks')
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedId },
      { onConflict: 'blocker_id,blocked_id' },
    );
  return { error: error?.message ?? null };
}

/** 解除封鎖。*/
export async function unblockUser(
  blockerId: string | null,
  blockedId: string | null,
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured || !supabase || !blockerId || !blockedId) return { error: null };
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  return { error: error?.message ?? null };
}

/**
 * 撈出「與我有封鎖關係」的所有對方 id（雙向）：我封鎖的人 + 封鎖我的人。
 * RLS 允許讀取任一端是自己的封鎖列，故一次查詢即可取得兩個方向。
 * 任務池用這個集合把對方的單過濾掉 → 封鎖任一方都不再互相媒合。
 */
export async function fetchBlockedUserIds(userId: string | null): Promise<Set<string>> {
  if (!isSupabaseConfigured || !supabase || !userId) return new Set();
  const { data } = await supabase
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
  const out = new Set<string>();
  for (const row of (data as { blocker_id: string; blocked_id: string }[] | null) ?? []) {
    out.add(row.blocker_id === userId ? row.blocked_id : row.blocker_id);
  }
  return out;
}

/**
 * 對某訂單提出爭議申訴。訂單狀態不變（款項維持保留狀態，例如 verifying 時
 * 獵人尚未撥款）→ 交由後台客服裁決。回傳 ok 供 UI 提示。
 */
export async function raiseDispute(
  orderId: string | null,
  reason: string,
): Promise<{ ok: boolean; error: string | null }> {
  if (!isSupabaseConfigured || !supabase || !orderId) return { ok: true, error: null };
  const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
  if (!uid) return { ok: false, error: 'unauth' };
  const { error } = await supabase
    .from('disputes')
    .insert({ order_id: orderId, raised_by: uid, reason });
  return { ok: !error, error: error?.message ?? null };
}
