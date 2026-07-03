// Edge Function `notify` — 推播發送的唯一出口（Deno runtime）。
//
// 為什麼不讓 App 直接打 Expo Push API？
// 那需要前端讀得到「收件人的 token」→ token 就得對其他使用者開放讀取 →
// 任何人都能對任何裝置無限發垃圾推播。收進 Edge Function 後，
// token 只存在 service_role 查詢裡，前端只送「事件」，收件人與文案都在這裡決定。
//
// 安全模型：
// - 平台層先驗 JWT（verify_jwt=true，未登入直接 401）。
// - 函式內再做「事件層授權」：new_order 只有發單人本人能觸發、
//   order_accepted 只有該單獵人、new_message 只有該單當事人 —— 全部對照 DB 現況，
//   偽造 order_id 或替別人觸發都會被拒。
// - 文案內容（金額 / 距離 / 名字）一律取自 DB，不信任 client 傳來的值
//   （唯一例外是訊息預覽文字，那本來就是使用者輸入）。

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// 與 App 端 src/data/tasks.ts 的 PLATFORM_FEE_RATE / netEarning 保持一致
const FEE_RATE = 0.15;

type Payload =
  | { type: 'new_order'; order_id: string }
  | { type: 'order_accepted'; order_id: string }
  | { type: 'order_verifying'; order_id: string }
  | { type: 'order_completed'; order_id: string }
  | { type: 'new_message'; order_id: string; preview?: string };

interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  channelId: 'default';
  priority: 'high';
  data: { route: string };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Haversine 直線距離（公尺）——與 App 端 src/lib/geo.ts 同款 */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** 與 App 端 etaMinFromMeters 同款：市區機車約 250 m/分，夾在 2–120 分 */
function etaMin(m: number): number {
  return Math.min(120, Math.max(2, Math.round(m / 250)));
}

function distText(m: number): string {
  return m < 1000 ? `${m} 公尺` : `${(m / 1000).toFixed(1)} 公里`;
}

function hasCoords(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0);
}

/**
 * 批次打 Expo Push API（每批上限 100 則）。
 * 回票 DeviceNotRegistered（App 被刪 / token 失效）→ 順手清掉該 token 列。
 */
async function sendPushes(admin: SupabaseClient, pushes: PushMessage[]): Promise<number> {
  if (pushes.length === 0) return 0;
  let sent = 0;
  const dead: string[] = [];
  for (let i = 0; i < pushes.length; i += 100) {
    const chunk = pushes.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) continue;
    const { data: tickets } = (await res.json()) as {
      data?: { status: string; details?: { error?: string } }[];
    };
    tickets?.forEach((t, idx) => {
      if (t.status === 'ok') sent += 1;
      else if (t.details?.error === 'DeviceNotRegistered') dead.push(chunk[idx].to);
    });
  }
  if (dead.length > 0) await admin.from('push_tokens').delete().in('token', dead);
  return sent;
}

Deno.serve(async (req) => {
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 解出呼叫者身分（JWT 已由平台層驗過簽章與效期）
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData } = await admin.auth.getUser(jwt);
    const uid = userData?.user?.id;
    if (!uid) return json({ error: 'unauth' }, 401);

    const payload = (await req.json().catch(() => null)) as Payload | null;
    if (!payload?.type || !payload.order_id) return json({ error: 'bad_request' }, 400);

    const { data: order } = await admin
      .from('orders')
      .select('*')
      .eq('id', payload.order_id)
      .maybeSingle();
    if (!order) return json({ error: 'order_not_found' }, 404);

    const pushes: PushMessage[] = [];

    if (payload.type === 'new_order') {
      // 只有發單人本人、且訂單仍在池子裡，才能觸發廣播
      if (order.client_id !== uid || order.status !== 'searching') {
        return json({ error: 'forbidden' }, 403);
      }
      const { data: tokens } = await admin
        .from('push_tokens')
        .select('user_id, token, lat, lng')
        .neq('user_id', uid);
      const ids = (tokens ?? []).map((t) => t.user_id);
      if (ids.length === 0) return json({ ok: true, sent: 0 });

      const [{ data: profs }, { data: busyRows }] = await Promise.all([
        admin
          .from('profiles')
          .select('id, completed_tasks, gender, search_radius_km, suspended_until, is_online')
          .in('id', ids),
        admin
          .from('orders')
          .select('hunter_id')
          .in('status', ['matched', 'verifying'])
          .in('hunter_id', ids),
      ]);
      const profById = new Map((profs ?? []).map((p) => [p.id, p]));
      const busy = new Set((busyRows ?? []).map((r) => r.hunter_id));
      const net = Math.round((order.price ?? 0) * (1 - FEE_RATE));

      for (const t of tokens ?? []) {
        const p = profById.get(t.user_id);
        if (!p) continue;
        if (!p.is_online) continue; // 休息中的獵人不吵（上線開關）
        if (busy.has(t.user_id)) continue; // 手上有任務的獵人不吵
        if (p.suspended_until && new Date(p.suspended_until) > new Date()) continue; // 停權中
        if ((order.min_completed ?? 0) > (p.completed_tasks ?? 0)) continue; // 等級不足
        const pref = order.gender_pref ?? 'any';
        if (pref !== 'any' && pref !== p.gender) continue; // 性別不符
        // 半徑篩選：與任務池同邏輯 —— 兩端座標齊全才過濾，算不出來不誤殺
        let d: number | null = null;
        if (hasCoords(t.lat, t.lng) && hasCoords(order.location_lat, order.location_lng)) {
          d = distanceMeters(t.lat, t.lng, order.location_lat, order.location_lng);
          if (d > (p.search_radius_km ?? 2) * 1000) continue;
        }
        pushes.push({
          to: t.token,
          title: '🚨 那個，出現了！',
          body: d != null ? `距離你約 ${distText(d)}，淨賺 $${net}` : `就在你附近，淨賺 $${net}`,
          sound: 'default',
          channelId: 'default',
          priority: 'high',
          data: { route: '/hunter' },
        });
      }
    } else if (payload.type === 'order_accepted') {
      // 只有該單「已媒合的獵人」能觸發，且訂單必須真的在 matched
      if (order.hunter_id !== uid || order.status !== 'matched' || !order.client_id) {
        return json({ error: 'forbidden' }, 403);
      }
      const { data: t } = await admin
        .from('push_tokens')
        .select('token')
        .eq('user_id', order.client_id)
        .maybeSingle();
      if (t?.token) {
        const known =
          hasCoords(order.hunter_lat, order.hunter_lng) &&
          hasCoords(order.location_lat, order.location_lng);
        const body = known
          ? `您的獵人已出發，預計 ${etaMin(
              distanceMeters(order.hunter_lat, order.hunter_lng, order.location_lat, order.location_lng),
            )} 分鐘後抵達！`
          : '您的獵人已出發，正在趕來的路上！';
        pushes.push({
          to: t.token,
          title: '🥾 獵人接單了！',
          body,
          sound: 'default',
          channelId: 'default',
          priority: 'high',
          data: { route: '/status' },
        });
      }
    } else if (payload.type === 'order_verifying') {
      // 只有該單獵人、且已成功切到 verifying，才能通知求救者來確認
      if (order.hunter_id !== uid || order.status !== 'verifying' || !order.client_id) {
        return json({ error: 'forbidden' }, 403);
      }
      const { data: t } = await admin
        .from('push_tokens')
        .select('token')
        .eq('user_id', order.client_id)
        .maybeSingle();
      if (t?.token) {
        pushes.push({
          to: t.token,
          title: '✅ 獵人回報已消滅目標！',
          body: '請確認現場狀況，按下「確認完成」後才會結案撥款。',
          sound: 'default',
          channelId: 'default',
          priority: 'high',
          data: { route: '/status' },
        });
      }
    } else if (payload.type === 'order_completed') {
      // 只有該單求救者、且訂單已真正結案，才能通知獵人酬勞入帳
      if (order.client_id !== uid || order.status !== 'completed' || !order.hunter_id) {
        return json({ error: 'forbidden' }, 403);
      }
      const { data: t } = await admin
        .from('push_tokens')
        .select('token')
        .eq('user_id', order.hunter_id)
        .maybeSingle();
      if (t?.token) {
        const net = Math.round((order.price ?? 0) * (1 - FEE_RATE));
        pushes.push({
          to: t.token,
          title: '🎉 任務完成，酬勞入帳！',
          body: `求救者已確認完成，$${net} 已存入你的錢包。`,
          sound: 'default',
          channelId: 'default',
          priority: 'high',
          data: { route: '/hunter' },
        });
      }
    } else if (payload.type === 'new_message') {
      // 只有訂單當事人能觸發；與 messages 的 RLS 同步 —— matched / verifying 期間可推
      const isParty = uid === order.client_id || uid === order.hunter_id;
      if (!isParty || !['matched', 'verifying'].includes(order.status)) {
        return json({ error: 'forbidden' }, 403);
      }
      const recipient = uid === order.client_id ? order.hunter_id : order.client_id;
      if (recipient) {
        const [{ data: t }, { data: sender }] = await Promise.all([
          admin.from('push_tokens').select('token').eq('user_id', recipient).maybeSingle(),
          admin.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
        ]);
        if (t?.token) {
          const preview = (payload.preview ?? '').trim().slice(0, 60) || '傳來一則新訊息';
          pushes.push({
            to: t.token,
            title: sender?.display_name ?? '新訊息',
            body: preview,
            sound: 'default',
            channelId: 'default',
            priority: 'high',
            data: { route: recipient === order.client_id ? '/status' : '/hunter/task' },
          });
        }
      }
    }

    const sent = await sendPushes(admin, pushes);
    return json({ ok: true, sent });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'internal' }, 500);
  }
});
