import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/** 帳本事件種類（對應 SQL 結算 RPC 寫入的 kind）*/
export type WalletTxKind =
  | 'task_payout' // 任務完成酬勞（獵人）
  | 'escape_fee' // 撲空車馬費（獵人）
  | 'escape_refund' // 撲空退款（求救者）
  | 'cancel_penalty' // 中途取消出勤補償（獵人）
  | 'cancel_refund' // 中途取消退款（求救者）
  | 'adjustment'; // 後台人工調整

/** 對應 SQL 的 public.wallet_transactions 一列 */
export interface WalletTx {
  id: string;
  user_id: string;
  order_id: string | null;
  kind: WalletTxKind;
  amount: number;
  memo: string | null;
  created_at: string;
}

/** kind → 顯示標籤（memo 為主，這是無 memo 時的後備 / 分類用）*/
export const WALLET_KIND_LABEL: Record<WalletTxKind, string> = {
  task_payout: '任務完成酬勞',
  escape_fee: '撲空車馬費',
  escape_refund: '撲空退款',
  cancel_penalty: '出勤補償金',
  cancel_refund: '中途取消退款',
  adjustment: '客服調整',
};

const TX_COLS = 'id, user_id, order_id, kind, amount, memo, created_at';

/**
 * 讀取自己的儲值金帳本（新到舊）。受 RLS 保護：只會回自己的帳。
 * 未設定 Supabase / 表尚未建立時回空陣列（歷史頁退回舊的推導式明細）。
 */
export async function fetchWalletTransactions(userId: string | null): Promise<WalletTx[]> {
  if (!isSupabaseConfigured || !supabase || !userId) return [];
  const { data } = await supabase
    .from('wallet_transactions')
    .select(TX_COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  return (data as WalletTx[] | null) ?? [];
}
