-- 「乾，出現了！」 orders 資料表
-- 在 Supabase 後台 → SQL Editor 貼上執行即可。

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references auth.users (id) on delete set null,
  hunter_id     uuid references auth.users (id) on delete set null,
  target_size   text not null check (target_size in ('小', '大', '飛')),
  status        text not null default 'searching'
                  check (status in ('searching', 'matched', 'completed', 'cancelled', 'escaped')),
  location_lat  double precision,
  location_lng  double precision,
  -- 獵人接單當下的座標（讓求救端能算出 hunter→client 的真實距離 / ETA）
  hunter_lat    double precision,
  hunter_lng    double precision,
  price         integer,
  -- 求救者的進階篩選：性別偏好 + 最低經驗（completed_tasks）要求
  gender_pref   text not null default 'any' check (gender_pref in ('any', 'male', 'female')),
  min_completed integer not null default 0,
  -- 第十階段：是否請獵人自備工具（true 時加收工具費）
  needs_tools   boolean not null default false,
  -- 第十一階段：VVIP 急件標記（由 trigger 依發單者實際完成數判定，前端無法偽造）
  is_vip        boolean not null default false,
  -- 註：精確地址 / 進入指引「不」放這裡 —— 已於第九階段搬到 order_private（DB 級隱私）
  created_at    timestamptz not null default now()
);

create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_client_idx on public.orders (client_id);

-- ── Row Level Security ─────────────────────────────────────────────
alter table public.orders enable row level security;

-- 求救者只能建立 client_id = 自己 的訂單
drop policy if exists "clients insert own orders" on public.orders;
create policy "clients insert own orders"
  on public.orders for insert
  to authenticated
  with check (auth.uid() = client_id);

-- 看得到：自己發的單、尚在徵人的單(searching)、或自己接的單
drop policy if exists "read own or open orders" on public.orders;
create policy "read own or open orders"
  on public.orders for select
  to authenticated
  using (
    auth.uid() = client_id
    or status = 'searching'
    or auth.uid() = hunter_id
  );

-- 更新：自己是 client / hunter，或正在接一張 searching 的單
drop policy if exists "update own or accepting orders" on public.orders;
create policy "update own or accepting orders"
  on public.orders for update
  to authenticated
  using (auth.uid() = client_id or auth.uid() = hunter_id or status = 'searching')
  with check (true);

-- ── Realtime ───────────────────────────────────────────────────────
-- 讓前端能 subscribe 到 UPDATE；full 可讓事件帶完整列資料
alter table public.orders replica identity full;

-- 確保 realtime publication 存在（有些新專案 / 被刪過的專案會沒有），
-- 再把 orders 加進去；已存在則略過，整段可重複執行不報錯。
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end$$;

-- ── 既有資料表升級 ─────────────────────────────────────────────────
-- 若你先前已執行過「沒有 cancelled」的舊版 schema，請『補跑這段』即可：
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('searching', 'matched', 'completed', 'cancelled', 'escaped'));

-- 第六階段：替既有 orders 補上獵人座標欄位（idempotent）
alter table public.orders add column if not exists hunter_lat double precision;
alter table public.orders add column if not exists hunter_lng double precision;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  第六階段：使用者檔案 profiles                                      ║
-- ╚══════════════════════════════════════════════════════════════════╝
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  display_name    text not null default '求救者',
  avatar_url      text,
  rating          numeric not null default 5.0,
  completed_tasks integer not null default 0,
  -- 第七階段：性別 + 認證狀態
  gender          text not null default 'unspecified' check (gender in ('male', 'female', 'unspecified')),
  id_verified     boolean not null default false,
  police_verified boolean not null default false,
  -- 第八階段：獵人自訂接單半徑（公里），高階特權，預設 2
  search_radius_km integer not null default 2,
  -- 第十階段：虛擬錢包餘額（超收 / 撲空退款的儲值金）
  wallet_balance  integer not null default 0,
  updated_at      timestamptz not null default now()
);

-- ── Row Level Security ─────────────────────────────────────────────
alter table public.profiles enable row level security;

-- 所有登入者都能讀任何人的 profile（要看到對方名稱 / 評分）
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- 只能建立 id = 自己 的 profile（upsert 的 insert 分支）
drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- 只能更新自己的 profile
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  第七階段：進階定價 / 等級 / 認證（既有資料表補欄位，idempotent） ║
-- ╚══════════════════════════════════════════════════════════════════╝
-- orders：求救者進階篩選
alter table public.orders add column if not exists gender_pref text not null default 'any';
alter table public.orders drop constraint if exists orders_gender_pref_check;
alter table public.orders add constraint orders_gender_pref_check
  check (gender_pref in ('any', 'male', 'female'));
alter table public.orders add column if not exists min_completed integer not null default 0;

-- profiles：性別 + 認證
alter table public.profiles add column if not exists gender text not null default 'unspecified';
alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check
  check (gender in ('male', 'female', 'unspecified'));
alter table public.profiles add column if not exists id_verified boolean not null default false;
alter table public.profiles add column if not exists police_verified boolean not null default false;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  第八階段：隱私 + 獵人自訂接單半徑（idempotent）                  ║
-- ╚══════════════════════════════════════════════════════════════════╝
-- 註：第八階段原本在 orders 上加 exact_address / entry_instructions，
--     已於第九階段改為獨立的 order_private 表（見下方），這裡不再補欄位。

-- profiles：獵人自訂接單半徑（公里），預設 2
alter table public.profiles add column if not exists search_radius_km integer not null default 2;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  第九階段：求救者地址基底 + DB 級終極隱私（idempotent）           ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- (1) profiles：求救者可預存的「地址基底」（模糊地址，發單時自動帶入當底稿）
alter table public.profiles add column if not exists default_location_name text;

-- (2) DB 級終極隱私：把精確地址搬到獨立私密表，orders 本身不再持有敏感欄位。
--     orders 維持寬鬆 RLS 讓任務池 + Realtime 照常運作；敏感資料則放在這張
--     「行級鎖死」的表 —— searching 階段（hunter_id 為 NULL）除了 client 本人，
--     任何人（即使直接打 REST API）都讀不到。order_private 不加入 Realtime publication。
create table if not exists public.order_private (
  order_id           uuid primary key references public.orders (id) on delete cascade,
  exact_address      text,
  entry_instructions text
);

alter table public.order_private enable row level security;

-- 寫入：只有訂單的 client 本人
drop policy if exists "client inserts own order_private" on public.order_private;
create policy "client inserts own order_private"
  on public.order_private for insert
  to authenticated
  with check (
    exists (select 1 from public.orders o where o.id = order_id and o.client_id = auth.uid())
  );

-- 更新：只有訂單的 client 本人
drop policy if exists "client updates own order_private" on public.order_private;
create policy "client updates own order_private"
  on public.order_private for update
  to authenticated
  using (
    exists (select 1 from public.orders o where o.id = order_id and o.client_id = auth.uid())
  )
  with check (
    exists (select 1 from public.orders o where o.id = order_id and o.client_id = auth.uid())
  );

-- 讀取：只有 client 本人，或【已成功媒合】的 hunter 本人。
-- searching 階段 hunter_id 為 NULL → 此時除本人外沒有任何人讀得到精確地址（DB 級保證）。
drop policy if exists "owner or matched hunter reads order_private" on public.order_private;
create policy "owner or matched hunter reads order_private"
  on public.order_private for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.client_id = auth.uid() or o.hunter_id = auth.uid())
    )
  );

-- (3) 既有資料遷移：把舊版存在 orders 上的精確地址搬進 order_private（欄位還在才跑）。
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'exact_address'
  ) then
    insert into public.order_private (order_id, exact_address, entry_instructions)
    select id, exact_address, entry_instructions
    from public.orders
    where exact_address is not null or entry_instructions is not null
    on conflict (order_id) do nothing;
  end if;
end$$;

-- (4) 移除 orders 上已搬走的敏感欄位，徹底杜絕任務池 / Realtime 的外洩面（無欄位則略過）。
alter table public.orders drop column if exists exact_address;
alter table public.orders drop column if exists entry_instructions;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  第十階段：工具費 + 虛擬錢包 + 撲空車馬費結算（idempotent）       ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- (1) orders：是否請獵人自備工具
alter table public.orders add column if not exists needs_tools boolean not null default false;

-- (2) orders.status 允許 'escaped'（撲空）。上方「既有資料表升級」段已重設
--     orders_status_check 包含 escaped；此處再保險一次（重複執行不報錯）。
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('searching', 'matched', 'completed', 'cancelled', 'escaped'));

-- (3) profiles：虛擬錢包餘額（儲值金）
alter table public.profiles add column if not exists wallet_balance integer not null default 0;

-- (4) 撲空結算 RPC：把「改單狀態 + 雙方錢包異動」包成一個原子交易。
--     用 SECURITY DEFINER 是因為一般 RLS 不允許獵人去改求救者的 profile；
--     函式內自行驗證呼叫者必須是該訂單『已媒合的獵人』，避免被濫用。
create or replace function public.settle_escaped(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client  uuid;
  v_hunter  uuid;
  v_price   integer;
  v_status  text;
  v_refund  integer;
  v_fee     constant integer := 150; -- 固定車馬費
begin
  select client_id, hunter_id, coalesce(price, 0), status
    into v_client, v_hunter, v_price, v_status
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;
  -- 僅允許「已媒合的本獵人」在 matched 狀態下結算撲空
  if auth.uid() is distinct from v_hunter then
    raise exception 'only the matched hunter can settle this order';
  end if;
  if v_status <> 'matched' then
    raise exception 'order is not in matched state (current: %)', v_status;
  end if;

  v_refund := greatest(v_price - v_fee, 0);

  update public.orders set status = 'escaped' where id = p_order_id;

  -- 獵人獲得固定車馬費
  update public.profiles set wallet_balance = wallet_balance + v_fee where id = v_hunter;
  -- 發單者預付總額扣除車馬費後的差額，退成儲值金
  if v_client is not null and v_refund > 0 then
    update public.profiles set wallet_balance = wallet_balance + v_refund where id = v_client;
  end if;
end;
$$;

grant execute on function public.settle_escaped(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  第十一階段：求救者稱號 + VVIP 優先派單（idempotent）             ║
-- ╚══════════════════════════════════════════════════════════════════╝
-- 註：求救者「累積完成的呼救數」不另存欄位，直接 count 自己 status=completed
--     的訂單（orders 的 RLS 已允許 client 讀自己的單）→ 永遠精準、不會漂移。
--     0 趟「初階驚嚇者」／3 趟「冷靜的課金大佬」／10 趟「VVIP 領域展開」。

-- (1) orders：VVIP 急件標記。VVIP（累積完成 ≥ 10）發單時自動為 true。
alter table public.orders add column if not exists is_vip boolean not null default false;
-- 部分索引：任務池排序 / 篩 VIP 用，只索引 true 的少數列
create index if not exists orders_vip_idx on public.orders (is_vip) where is_vip;

-- (2) VVIP 判定 trigger：發單當下，依「該 client_id 實際完成的呼救數」決定 is_vip。
--     用 SECURITY DEFINER + BEFORE INSERT 由 DB 計算並覆寫 is_vip → 即使惡意前端
--     硬塞 is_vip=true 也會被重算，無法偽造 VVIP 身分。門檻 10 與 App 端一致。
create or replace function public.set_order_vip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_vip := (
    select count(*) >= 10
    from public.orders
    where client_id = new.client_id
      and status = 'completed'
  );
  return new;
end;
$$;

drop trigger if exists trg_set_order_vip on public.orders;
create trigger trg_set_order_vip
  before insert on public.orders
  for each row
  execute function public.set_order_vip();


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  第十二階段：評價系統真實寫入（idempotent）                       ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- (1) ratings：每筆評價一列。同一張單、同一評價者只能留一筆（可覆蓋）。
create table if not exists public.ratings (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  rater_id   uuid not null references auth.users (id) on delete cascade,
  ratee_id   uuid not null references auth.users (id) on delete cascade,
  stars      integer not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  unique (order_id, rater_id)
);
create index if not exists ratings_ratee_idx on public.ratings (ratee_id);

alter table public.ratings enable row level security;

-- 讀取：登入者皆可讀（顯示 / 稽核用）
drop policy if exists "ratings readable by authenticated" on public.ratings;
create policy "ratings readable by authenticated"
  on public.ratings for select to authenticated using (true);

-- 寫入：只能以自己為 rater 新增（實際寫入走下方 RPC，這條是保險）
drop policy if exists "users insert own ratings" on public.ratings;
create policy "users insert own ratings"
  on public.ratings for insert to authenticated
  with check (auth.uid() = rater_id);

-- (2) submit_rating RPC：寫入/覆蓋這次評分 → 重算被評價者平均 → 更新 profiles.rating。
--     用 SECURITY DEFINER 是因為「更新對方的 profiles.rating」屬跨人寫入，一般 RLS
--     不允許；函式內自行驗證評價者與被評價者必須正好是這張單的 client / hunter 兩端，
--     且不可自評，避免被濫用刷分。回傳重算後的新平均星數。
create or replace function public.submit_rating(p_order_id uuid, p_ratee uuid, p_stars integer)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_hunter uuid;
  v_rater  uuid := auth.uid();
  v_avg    numeric;
begin
  if p_stars < 1 or p_stars > 5 then
    raise exception 'stars must be between 1 and 5';
  end if;

  select client_id, hunter_id into v_client, v_hunter
  from public.orders where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
  if v_hunter is null then raise exception 'order is not matched yet'; end if;

  -- 評價者與被評價者必須是這張單的兩端（client ↔ hunter），且不能自評
  if v_rater is null
     or v_rater = p_ratee
     or v_rater not in (v_client, v_hunter)
     or p_ratee not in (v_client, v_hunter) then
    raise exception 'rater/ratee must be the two parties of this order';
  end if;

  -- 寫入或覆蓋這次評分（同一張單、同一評價者只留最新一次）
  insert into public.ratings (order_id, rater_id, ratee_id, stars)
  values (p_order_id, v_rater, p_ratee, p_stars)
  on conflict (order_id, rater_id)
  do update set stars = excluded.stars, ratee_id = excluded.ratee_id, created_at = now();

  -- 重算被評價者的平均星數，更新回 profiles（無評價時退回預設 5.0）
  select round(avg(stars)::numeric, 2) into v_avg
  from public.ratings where ratee_id = p_ratee;

  update public.profiles set rating = coalesce(v_avg, 5.0) where id = p_ratee;
  return coalesce(v_avg, 5.0);
end;
$$;

grant execute on function public.submit_rating(uuid, uuid, integer) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  第十三階段：即時聊天 + KYC 認證狀態 + Storage（idempotent）      ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── (A) 即時聊天 messages ───────────────────────────────────────────
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  sender_id  uuid references auth.users (id) on delete set null,
  content    text not null check (length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_order_idx on public.messages (order_id, created_at);

alter table public.messages enable row level security;

-- 讀取：只有該訂單的 client / hunter
drop policy if exists "order parties read messages" on public.messages;
create policy "order parties read messages"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and (o.client_id = auth.uid() or o.hunter_id = auth.uid())
    )
  );

-- 發送：只有該訂單的 client / hunter，且 sender 必須是自己
drop policy if exists "order parties send messages" on public.messages;
create policy "order parties send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id and (o.client_id = auth.uid() or o.hunter_id = auth.uid())
    )
  );

-- Realtime：讓雙方即時收到新訊息
alter table public.messages replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end$$;

-- ── (B) profiles：認證改為狀態字串（none / pending / verified / rejected）──
alter table public.profiles add column if not exists id_verification_status text not null default 'none';
alter table public.profiles drop constraint if exists profiles_id_verif_status_check;
alter table public.profiles add constraint profiles_id_verif_status_check
  check (id_verification_status in ('none', 'pending', 'verified', 'rejected'));

alter table public.profiles add column if not exists police_verification_status text not null default 'none';
alter table public.profiles drop constraint if exists profiles_police_verif_status_check;
alter table public.profiles add constraint profiles_police_verif_status_check
  check (police_verification_status in ('none', 'pending', 'verified', 'rejected'));

-- 從舊布林欄位遷移既有資料（true → verified）。欄位還在才跑，避免新庫報錯。
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'id_verified'
  ) then
    update public.profiles set id_verification_status = 'verified'
      where id_verification_status = 'none' and coalesce(id_verified, false) = true;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'police_verified'
  ) then
    update public.profiles set police_verification_status = 'verified'
      where police_verification_status = 'none' and coalesce(police_verified, false) = true;
  end if;
end$$;

-- ── (C) Storage：KYC 文件桶 verifications（私有）+ Policy ───────────
-- 建桶（私有，非公開）。已存在則略過。
insert into storage.buckets (id, name, public)
values ('verifications', 'verifications', false)
on conflict (id) do nothing;

-- 上傳：只能寫進「以自己 uid 為名的資料夾」（path 第一段 = auth.uid()）
drop policy if exists "verif upload own" on storage.objects;
create policy "verif upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verifications' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 覆蓋自己的檔案（被退件後重新上傳）
drop policy if exists "verif update own" on storage.objects;
create policy "verif update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'verifications' and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'verifications' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 讀取：僅限登入者（平台審核人員用；非公開）
drop policy if exists "verif read authenticated" on storage.objects;
create policy "verif read authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'verifications');


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  第十四階段：資安加固（Unhappy Paths & Security Audit）           ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── (A) 原子搶單 RPC + 收緊 orders 寫入政策 ─────────────────────────
-- 漏洞：舊 UPDATE 政策 using(... or status='searching') + with check(true)
--       讓「任何登入者」都能改寫任一張 searching 單的任何欄位
--       （price / is_vip / status / client_id …）→ P0 授權破口。
-- 修法：搶單改走 SECURITY DEFINER RPC（單一交易內完成搶單 + 座標 +
--       matched_at + 停權檢查），orders 的 UPDATE 政策收緊成
--       「只有當事人能改自己的單」，徹底拔掉 searching 逃生門。

-- 媒合時間戳（逾時回報 / 自動回收的依據）
alter table public.orders add column if not exists matched_at timestamptz;
-- 既有 matched 單補上媒合時間（以建單時間近似），讓逾時機制立即可用
update public.orders set matched_at = created_at
 where status = 'matched' and matched_at is null;

-- profiles：爽約計數 + 停權期限（no-show 懲罰、接單資格檢查用）
alter table public.profiles add column if not exists no_show_count integer not null default 0;
alter table public.profiles add column if not exists suspended_until timestamptz;

create or replace function public.accept_order(
  p_order_id uuid,
  p_lat double precision default null,
  p_lng double precision default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hunter  uuid := auth.uid();
  v_updated uuid;
begin
  if v_hunter is null then
    return jsonb_build_object('ok', false, 'reason', 'unauth');
  end if;

  -- 停權中的獵人不得接單（爽約 3 次 → 停權 24 小時，見 report_no_show）
  if exists (
    select 1 from public.profiles
    where id = v_hunter and suspended_until is not null and suspended_until > now()
  ) then
    return jsonb_build_object('ok', false, 'reason', 'suspended');
  end if;

  -- 原子搶單：條件式 UPDATE。Postgres row lock 會把同毫秒的兩個請求
  -- 序列化 —— 第二人重新評估 WHERE 時 status 已非 searching → 命中 0 列。
  update public.orders
     set status     = 'matched',
         hunter_id  = v_hunter,
         hunter_lat = coalesce(p_lat, hunter_lat),
         hunter_lng = coalesce(p_lng, hunter_lng),
         matched_at = now()
   where id = p_order_id
     and status = 'searching'
     and hunter_id is null
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('ok', false, 'reason', 'already_taken');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.accept_order(uuid, double precision, double precision) to authenticated;

-- 收緊寫入政策：只有當事人（client / hunter）能更新自己的單。
-- 搶單已改走上方 RPC（definer 權限），不再需要 searching 逃生門。
drop policy if exists "update own or accepting orders" on public.orders;
drop policy if exists "parties update own orders" on public.orders;
create policy "parties update own orders"
  on public.orders for update
  to authenticated
  using (auth.uid() = client_id or auth.uid() = hunter_id)
  with check (auth.uid() = client_id or auth.uid() = hunter_id);

-- ── (D) 惡意佔單防禦：逾時未到 → 回收重新媒合 + 爽約懲罰 ───────────
-- 求救者主動回報（MVP 首選，零基礎設施成本）。RPC 內驗證：
--   呼叫者 = 該單 client、狀態 = matched、已超過 20 分鐘寬限期。
-- 成立則：訂單退回任務池（searching、清空 hunter 欄位），
--         獵人 no_show_count +1，累積 3 次自動停權 24 小時。
create or replace function public.report_no_show(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client  uuid;
  v_hunter  uuid;
  v_status  text;
  v_matched timestamptz;
  v_grace   constant interval := interval '20 minutes';
begin
  -- for update 行鎖：避免與獵人同時按「完成」產生競態
  select client_id, hunter_id, status, matched_at
    into v_client, v_hunter, v_status, v_matched
  from public.orders where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if auth.uid() is distinct from v_client then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_status <> 'matched' then
    return jsonb_build_object('ok', false, 'reason', 'not_matched');
  end if;
  if v_matched is null or now() - v_matched < v_grace then
    return jsonb_build_object('ok', false, 'reason', 'too_early');
  end if;

  -- 退回任務池重新媒合
  update public.orders
     set status = 'searching', hunter_id = null,
         hunter_lat = null, hunter_lng = null, matched_at = null
   where id = p_order_id;

  -- 記獵人一次爽約；達 3 次自動停權 24 小時
  if v_hunter is not null then
    update public.profiles
       set no_show_count   = no_show_count + 1,
           suspended_until = case when no_show_count + 1 >= 3
                                  then now() + interval '24 hours'
                                  else suspended_until end
     where id = v_hunter;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.report_no_show(uuid) to authenticated;

-- （選用）pg_cron 自動回收孤兒單：Dashboard → Database → Extensions 啟用
-- pg_cron 後，取消下面註解執行一次即可（每 5 分鐘掃一次，45 分鐘未動作回收）。
-- select cron.schedule('expire-stale-matched', '*/5 * * * *', $c$
--   update public.orders
--      set status = 'searching', hunter_id = null,
--          hunter_lat = null, hunter_lng = null, matched_at = null
--    where status = 'matched' and matched_at < now() - interval '45 minutes';
-- $c$);

-- ── (C) RLS 越權修補：權限綁定訂單狀態，取消即斷 ────────────────────
-- 漏洞：cancelOrder 只改 status 不清 hunter_id，而 order_private / messages
--       的政策只看「hunter_id = 我」→ 被取消的獵人永久保有讀取權，
--       能繼續查精確地址、繼續收到聊天 Realtime 推播。
-- 修法：政策加上狀態條件。Realtime postgres_changes 對每個訂閱者每則
--       事件重新套用 SELECT 政策 → 政策一收緊，殘留的 channel 立即失效。

-- 精確地址：client 本人永遠可讀；獵人僅 matched 期間可讀
drop policy if exists "owner or matched hunter reads order_private" on public.order_private;
create policy "owner or matched hunter reads order_private"
  on public.order_private for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.client_id = auth.uid()
             or (o.hunter_id = auth.uid() and o.status = 'matched'))
    )
  );

-- 聊天讀取：client 永遠可讀；獵人限 matched / completed（保留完工後查對話），
-- cancelled / escaped 一律斷線
drop policy if exists "order parties read messages" on public.messages;
create policy "order parties read messages"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.client_id = auth.uid()
             or (o.hunter_id = auth.uid() and o.status in ('matched', 'completed')))
    )
  );

-- 聊天發送：只有 matched 期間能發，訂單結束就不能再丟訊息
drop policy if exists "order parties send messages" on public.messages;
create policy "order parties send messages"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.status = 'matched'
        and (o.client_id = auth.uid() or o.hunter_id = auth.uid())
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- 第十五階段：推播通知（Expo Push Notifications）
-- ═══════════════════════════════════════════════════════════════════
-- 設計決策：token 不放 profiles。profiles 的 select 政策是「所有登入者可讀」
-- （獵人卡片要顯示對方名字/星等），Expo push token 一旦可被他人讀取，
-- 任何人都能拿去打 exp.host API 對該裝置無限發垃圾推播。
-- 因此 token 收進獨立的 push_tokens 表，RLS 僅本人可讀寫；
-- 發送方（Edge Function `notify`）用 service_role 讀取，天生繞過 RLS。
-- lat/lng 是獵人「最後已知位置」：情境 A（新單廣播）用來做半徑篩選與
-- 「距離你 X 公尺」文案；由 App 進任務池時順手更新，不做背景追蹤。

create table if not exists public.push_tokens (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  token      text not null,
  lat        double precision,
  lng        double precision,
  updated_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

drop policy if exists "own push token only" on public.push_tokens;
create policy "own push token only"
  on public.push_tokens for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
