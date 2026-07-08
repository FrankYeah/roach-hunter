import { signOut } from '@/lib/auth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * 刪除自己的帳號（App Store 硬性規定的 App 內刪除）。呼叫 Edge Function
 * `delete-account`（service role 刪 auth.users，cascade / set null 清理資料）。
 * 成功後一併登出、清本地狀態。
 *
 * reason:
 *  - 'active_orders'：有進行中的單 → 請先完成或取消再刪。
 *  - 'unavailable'：函式尚未部署或呼叫失敗。
 */
export async function deleteAccount(): Promise<{ ok: boolean; reason: string | null }> {
  if (!isSupabaseConfigured || !supabase) {
    await signOut(); // mock 模式：直接登出
    return { ok: true, reason: null };
  }
  const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) {
    // Edge Function 以 409 回報「有進行中的單」→ supabase-js 會把它當 error
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 409) return { ok: false, reason: 'active_orders' };
    return { ok: false, reason: 'unavailable' };
  }
  if ((data as { ok?: boolean })?.ok) {
    await signOut();
    return { ok: true, reason: null };
  }
  const reason = (data as { error?: string })?.error ?? 'unavailable';
  return { ok: false, reason: reason === 'active_orders' ? 'active_orders' : 'unavailable' };
}
