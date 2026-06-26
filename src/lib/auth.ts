import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

/**
 * Auth 包裝層：已設定 Supabase 時走真實 OTP，未設定時走 mock 後備。
 * 真實模式的登入/登出狀態由 supabase.auth.onAuthStateChange → applySession 驅動。
 */

/** 發送簡訊 OTP */
export async function requestOtp(phone: string): Promise<{ error: string | null }> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    return { error: error?.message ?? null };
  }
  return { error: null }; // mock：直接進到輸入驗證碼步驟
}

/** 驗證 OTP；mock 模式直接視為成功並寫入本地登入狀態 */
export async function verifyOtp(phone: string, token: string): Promise<{ error: string | null }> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    return { error: error?.message ?? null };
  }
  useAppStore.getState().login(phone); // mock 後備
  return { error: null };
}

/** 登出（兩種模式都清掉本地狀態）*/
export async function signOut(): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    await supabase.auth.signOut();
  }
  useAppStore.getState().logout();
}
