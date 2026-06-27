import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/** KYC 文件種類 → Storage 內的檔名 */
export type VerifyDoc = 'id' | 'police';

/**
 * 上傳實名認證文件到 Storage bucket `verifications`。
 * 路徑固定為 `${userId}/${doc}.jpg`，第一段資料夾 = 自己的 uid → 對齊 RLS
 * 「只能上傳到自己資料夾」的限制。upsert 允許被退件後重新上傳覆蓋。
 * 未設定 Supabase 時為 no-op（mock 流程仍可把狀態切到 pending 做 demo）。
 */
export async function uploadVerificationDoc(
  userId: string | null,
  doc: VerifyDoc,
  uri: string,
): Promise<{ path: string | null; error: string | null }> {
  if (!isSupabaseConfigured || !supabase || !userId) return { path: null, error: null };
  try {
    const res = await fetch(uri);
    const arrayBuffer = await res.arrayBuffer();
    const path = `${userId}/${doc}.jpg`;
    const { error } = await supabase.storage
      .from('verifications')
      .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
    if (error) return { path: null, error: error.message };
    return { path, error: null };
  } catch (e) {
    return { path: null, error: e instanceof Error ? e.message : '上傳失敗' };
  }
}
