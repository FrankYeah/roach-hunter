// Edge Function `delete-account` — App Store 硬性規定的「App 內刪除帳號」。
//
// 為什麼要 Edge Function：刪除 auth.users 需要 service_role（Admin API），
// 不能讓前端拿到那把鑰匙。這裡驗證呼叫者身分後，只刪「自己」這個帳號。
//
// 資料整併策略（靠 schema 的 FK 行為，一次 deleteUser 就乾淨）：
// - profiles / push_tokens / wallet_transactions / ratings / user_reports /
//   blocks / disputes → FK on delete cascade，隨帳號一起刪除。
// - orders.client_id / hunter_id、messages.sender_id → on delete set null，
//   訂單與對話「留給對方」，只是我方變匿名 → 不破壞對方的歷史與統計。
// - KYC 證件照（verifications bucket 的 {uid}/*）→ 這裡主動刪除。
//
// 安全：進行中的單（searching / matched / verifying）會擋下刪除，避免把對方
// 晾在半路。請先完成或取消再刪帳號。

import { createClient } from 'npm:@supabase/supabase-js@2';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData } = await admin.auth.getUser(jwt);
    const uid = userData?.user?.id;
    if (!uid) return json({ error: 'unauth' }, 401);

    // 進行中的單擋刪除，避免把對方晾在半路
    const { count } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .or(`client_id.eq.${uid},hunter_id.eq.${uid}`)
      .in('status', ['searching', 'matched', 'verifying']);
    if ((count ?? 0) > 0) {
      return json({ error: 'active_orders' }, 409);
    }

    // 刪 KYC 證件照（{uid}/ 底下所有檔案）
    const { data: files } = await admin.storage.from('verifications').list(uid);
    if (files && files.length > 0) {
      await admin.storage.from('verifications').remove(files.map((f) => `${uid}/${f.name}`));
    }

    // 刪帳號：cascade / set null 由 schema 的 FK 處理
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'internal' }, 500);
  }
});
