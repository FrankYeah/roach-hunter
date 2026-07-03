import { type RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { type TargetTier } from '@/constants/brand';
import { isValidLatLng } from '@/lib/geo';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { type LatLng } from '@/store/useAppStore';

export type OrderStatusDb = 'searching' | 'matched' | 'completed' | 'cancelled' | 'escaped';

/** DB 的 orders 一列（對應 SQL schema）*/
export interface OrderRow {
  id: string;
  client_id: string | null;
  hunter_id: string | null;
  target_size: '小' | '大' | '飛';
  status: OrderStatusDb;
  location_lat: number | null;
  location_lng: number | null;
  hunter_lat: number | null;
  hunter_lng: number | null;
  price: number | null;
  /** 求救者的進階篩選條件 */
  gender_pref: GenderPref;
  min_completed: number;
  /** 是否請獵人自備工具（true 時加收工具費）*/
  needs_tools: boolean;
  /** 是否為 VVIP 急件（由 DB trigger 依發單者實際完成數判定，前端無法偽造）*/
  is_vip: boolean;
  created_at: string;
}

/** 性別偏好：不拘 / 限男性 / 限女性 */
export type GenderPref = 'any' | 'male' | 'female';

/**
 * 私密資料（精確地址 / 進入指引）獨立於 order_private 表，由 DB 級 RLS 把關：
 * status=searching 時 hunter_id 為 NULL → 除了 client 本人，沒人讀得到（含直接打 API）。
 * 媒合成功後 hunter_id=自己 才解鎖。orders 本身不再持有這些欄位 → 任務池零外洩面。
 */
export interface OrderPrivate {
  order_id: string;
  exact_address: string | null;
  entry_instructions: string | null;
}

/**
 * 任務池對外揭露的安全列。orders 表已不含任何敏感欄位，故等同 OrderRow；
 * 仍保留明確欄位投影，避免日後新增敏感欄位時意外外洩。
 */
export type OpenOrderRow = OrderRow;
const OPEN_ORDER_COLS =
  'id, client_id, hunter_id, target_size, status, location_lat, location_lng, hunter_lat, hunter_lng, price, gender_pref, min_completed, needs_tools, is_vip, created_at';

/** tier id → DB target_size 短碼（對應 SQL 的 CHECK 限制）*/
const TARGET_SIZE: Record<TargetTier['id'], OrderRow['target_size']> = {
  small: '小',
  big: '大',
  flying: '飛',
};

/** DB target_size 短碼 → tier id */
export function tierIdFromSize(size: OrderRow['target_size']): TargetTier['id'] {
  return size === '小' ? 'small' : size === '大' ? 'big' : 'flying';
}

export interface CreateOrderInput {
  clientId: string | null;
  tierId: TargetTier['id'];
  price: number;
  lat: number | null;
  lng: number | null;
  genderPref: GenderPref;
  minCompleted: number;
  needsTools: boolean;
  exactAddress: string;
  entryInstructions: string | null;
}

/** 建立呼救訂單並寫入 Supabase。未設定 Supabase 時回傳 null（mock 後備）。*/
export async function createOrder(
  input: CreateOrderInput,
): Promise<{ id: string | null; error: string | null }> {
  if (!isSupabaseConfigured || !supabase) return { id: null, error: null };
  // 1) 寫入非敏感的訂單主體（任務池 / Realtime 看的就是這張表）
  const { data, error } = await supabase
    .from('orders')
    .insert({
      client_id: input.clientId,
      target_size: TARGET_SIZE[input.tierId],
      status: 'searching',
      location_lat: input.lat,
      location_lng: input.lng,
      price: input.price,
      gender_pref: input.genderPref,
      min_completed: input.minCompleted,
      needs_tools: input.needsTools,
    })
    .select('id')
    .single();
  const orderId = (data?.id as string | undefined) ?? null;
  if (error || !orderId) return { id: null, error: error?.message ?? null };
  // 2) 敏感資料寫進 order_private（DB 級 RLS 把關，searching 階段只有本人讀得到）
  const { error: privErr } = await supabase.from('order_private').insert({
    order_id: orderId,
    exact_address: input.exactAddress,
    entry_instructions: input.entryInstructions,
  });
  if (privErr) return { id: orderId, error: privErr.message };
  return { id: orderId, error: null };
}

/**
 * 求救者的「累積已完成呼救數」 —— 用來推導求救者稱號 / VVIP 身分。
 * 直接 count 自己（client_id = 自己）且 status = completed 的訂單；orders 的 RLS
 * 已允許 client 讀自己的單，故無需新增計數欄位，永遠精準、不會與真實狀態漂移。
 */
export async function fetchClientCompletedCount(userId: string | null): Promise<number> {
  if (!isSupabaseConfigured || !supabase || !userId) return 0;
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', userId)
    .eq('status', 'completed');
  return count ?? 0;
}

/** 讀取單一訂單（已不含敏感欄位；精確地址請改用 fetchOrderPrivate）*/
export async function fetchOrder(orderId: string): Promise<OrderRow | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
  return (data as OrderRow | null) ?? null;
}

/**
 * 接單後解鎖：讀取訂單的私密資料（精確地址 / 進入指引）。
 * 受 order_private 的 RLS 保護 —— 只有 client 本人或已媒合的 hunter 拿得到，
 * 其餘人（含搜尋中的訂單）查詢只會得到空結果。
 */
export async function fetchOrderPrivate(orderId: string): Promise<OrderPrivate | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase
    .from('order_private')
    .select('order_id, exact_address, entry_instructions')
    .eq('order_id', orderId)
    .maybeSingle();
  return (data as OrderPrivate | null) ?? null;
}

/**
 * 任務池：讀取所有 searching 中的訂單（新到舊）。
 * 隱私保護：只 select 安全欄位，精確地址 / 進入指引不進前端。
 */
export async function fetchOpenOrders(): Promise<OpenOrderRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data } = await supabase
    .from('orders')
    .select(OPEN_ORDER_COLS)
    .eq('status', 'searching')
    .order('created_at', { ascending: false });
  return (data as OpenOrderRow[] | null) ?? [];
}

/**
 * 我的歷史訂單：撈出我參與過的所有訂單（我是 client 或 hunter），新到舊。
 * orders 的 RLS 已允許讀「自己發的 / 自己接的」單，故此查詢只會回我自己的紀錄。
 */
export async function fetchMyOrders(userId: string | null): Promise<OrderRow[]> {
  if (!isSupabaseConfigured || !supabase || !userId) return [];
  const { data } = await supabase
    .from('orders')
    .select(OPEN_ORDER_COLS)
    .or(`client_id.eq.${userId},hunter_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data as OrderRow[] | null) ?? [];
}

/**
 * 送出評價：呼叫 SECURITY DEFINER RPC `submit_rating`，將這次星數寫入 ratings 表，
 * 並重新計算「被評價者」在 profiles 的平均星數。RPC 內驗證評價者必須是該訂單的
 * 當事人（client / hunter），且被評價者為另一方 → 杜絕亂評。回傳新的平均星數。
 */
export async function submitRating(
  orderId: string | null,
  rateeId: string | null,
  stars: number,
): Promise<{ rating: number | null; error: string | null }> {
  if (!isSupabaseConfigured || !supabase || !orderId || !rateeId) return { rating: null, error: null };
  const { data, error } = await supabase.rpc('submit_rating', {
    p_order_id: orderId,
    p_ratee: rateeId,
    p_stars: stars,
  });
  return { rating: typeof data === 'number' ? data : null, error: error?.message ?? null };
}

/** 搶單失敗原因：suspended = 爽約停權中；already_taken = 已被別人搶走 */
export type AcceptFailReason = 'suspended' | 'already_taken' | null;

/**
 * 搶單：優先呼叫 SECURITY DEFINER RPC `accept_order` —— 在單一交易內完成
 * 「條件式改 status + 寫入獵人座標 + 記 matched_at + 停權檢查」。
 * Postgres row lock 保證同毫秒兩人搶單只有一人成功（另一人命中 0 列）。
 * 尚未執行第十四階段 SQL（函式不存在）時，優雅退回舊版條件式 UPDATE，
 * 該路徑同樣具原子性（.eq status searching 的樂觀鎖），App 不會壞。
 */
export async function acceptOrder(
  orderId: string,
  hunterId: string,
  hunterLoc: LatLng | null,
): Promise<{ ok: boolean; reason: AcceptFailReason; error: string | null }> {
  if (!isSupabaseConfigured || !supabase) return { ok: true, reason: null, error: null };
  const loc = isValidLatLng(hunterLoc) ? hunterLoc : null;
  const { data, error } = await supabase.rpc('accept_order', {
    p_order_id: orderId,
    p_lat: loc?.latitude ?? null,
    p_lng: loc?.longitude ?? null,
  });
  if (!error) {
    const res = (data ?? {}) as { ok?: boolean; reason?: string };
    if (res.ok === true) return { ok: true, reason: null, error: null };
    return {
      ok: false,
      reason: res.reason === 'suspended' ? 'suspended' : 'already_taken',
      error: null,
    };
  }
  // RPC 尚未建立以外的錯誤（權限 / 網路）→ 直接回報，不退回舊路徑
  const missingFn =
    error.code === 'PGRST202' || error.message.includes('Could not find the function');
  if (!missingFn) return { ok: false, reason: null, error: error.message };
  // 舊路徑：條件式 UPDATE 搶單（僅在未跑第十四階段 SQL 時走到）
  const { data: legacy, error: legacyErr } = await supabase
    .from('orders')
    .update({ status: 'matched', hunter_id: hunterId })
    .eq('id', orderId)
    .eq('status', 'searching') // 只搶仍在 searching 的單 → 避免雙搶
    .select('id')
    .maybeSingle();
  if (legacyErr) return { ok: false, reason: null, error: legacyErr.message };
  if (!legacy) return { ok: false, reason: 'already_taken', error: null };
  // best-effort 寫入獵人座標（讓求救端能算 ETA）
  if (loc) {
    await supabase
      .from('orders')
      .update({ hunter_lat: loc.latitude, hunter_lng: loc.longitude })
      .eq('id', orderId);
  }
  return { ok: true, reason: null, error: null };
}

/**
 * 求救者取消：把訂單標記為 cancelled。
 * 狀態守衛：只有 searching / matched 能取消 —— 絕不覆蓋 completed / escaped
 * 等終態（例如取消鍵按下的同一瞬間獵人剛好結案）。
 */
export async function cancelOrder(orderId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  await supabase
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('id', orderId)
    .in('status', ['searching', 'matched']);
}

/**
 * 獵人回報完成。狀態守衛：只有仍在 matched 的單能標記 completed ——
 * 若求救者已在獵人斷線期間取消（cancelled），這裡命中 0 列回傳 ok:false，
 * 避免把 cancelled 蓋回 completed、污染完成數與等級／VVIP 判定。
 */
export async function completeOrderDb(orderId: string): Promise<{ ok: boolean }> {
  if (!isSupabaseConfigured || !supabase) return { ok: true };
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'completed' })
    .eq('id', orderId)
    .eq('status', 'matched')
    .select('id')
    .maybeSingle();
  return { ok: !error && !!data };
}

/**
 * 求救者回報「獵人逾時未到」：呼叫 SECURITY DEFINER RPC `report_no_show`。
 * RPC 內驗證呼叫者是該單 client、狀態 matched、且媒合已超過 20 分鐘寬限期，
 * 成立則訂單退回任務池重新媒合，獵人記一次爽約（累積 3 次自動停權 24 小時）。
 * reason: too_early = 未滿寬限期；unavailable = RPC 尚未建立或呼叫失敗。
 */
export async function reportNoShow(
  orderId: string,
): Promise<{ ok: boolean; reason: string | null }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, reason: 'unconfigured' };
  const { data, error } = await supabase.rpc('report_no_show', { p_order_id: orderId });
  if (error) return { ok: false, reason: 'unavailable' };
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  return { ok: res.ok === true, reason: res.reason ?? null };
}

/**
 * 撲空結算（目標逃逸）：呼叫 SECURITY DEFINER RPC `settle_escaped`，原子完成
 *  - 訂單 status → 'escaped'
 *  - 獵人錢包 +固定車馬費（$150）
 *  - 發單者預付總額扣除車馬費後的差額，退成儲值金存入發單者錢包
 * RPC 內會驗證呼叫者必須是該訂單「已媒合的獵人」，求救者的錢包更新也只能在
 * definer 權限下完成（一般 RLS 不允許跨人更新 profile）。
 */
export async function settleEscaped(orderId: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured || !supabase) return { error: null };
  const { error } = await supabase.rpc('settle_escaped', { p_order_id: orderId });
  return { error: error?.message ?? null };
}

/**
 * 每個訂閱都用唯一的 channel topic。
 * 原因：removeChannel() 是非同步的，若沿用固定 topic，當 effect 在
 * dev 重複掛載 / 快速切換頁面時重新訂閱，supabase-js 會回傳那個「尚未
 * 拆除完成、且已 subscribe()」的同名 channel，接著鏈上的 .on() 就會丟出
 * "cannot add postgres_changes callbacks ... after subscribe()"。
 * 唯一 topic 保證 .channel() 永遠回傳全新 channel，.on() 必在 subscribe() 前。
 */
let channelSeq = 0;

/**
 * 訂閱單一訂單的狀態更新（求救端用）。
 * 回傳取消訂閱函式；未設定 Supabase 時為 no-op。
 */
export function subscribeOrder(orderId: string, onUpdate: (row: OrderRow) => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`order:${orderId}:${++channelSeq}`)
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

/**
 * 訂閱 orders 表的任何變更（任務池用）。收到事件即呼叫 onChange，
 * 由呼叫端重新抓取 open orders。回傳取消訂閱函式。
 */
export function subscribeOpenOrders(onChange: () => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`orders:pool:${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => onChange())
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}
