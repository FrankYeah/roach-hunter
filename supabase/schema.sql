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

-- ═══════════════════════════════════════════════════════════════════
-- 第十六階段：核心交易體驗
-- （獵人上線開關 / 中途取消違約金 / 雙重確認結案）
-- ═══════════════════════════════════════════════════════════════════

-- ── (1) 獵人上線開關 ────────────────────────────────────────────────
-- 只決定「新單推播」要不要打給他；不影響他主動打開任務池瀏覽與接單。
alter table public.profiles add column if not exists is_online boolean not null default false;

-- ── (2) 狀態機加入 verifying（獵人回報已解決，等求救者確認結案）────
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('searching', 'matched', 'verifying', 'completed', 'cancelled', 'escaped'));

-- ── (3) 狀態機守衛 trigger ──────────────────────────────────────────
-- 錢包結算從此掛在狀態轉移上 →「誰能把狀態改成什麼」就是金流安全邊界。
-- 一般使用者直接 UPDATE 只允許三條不碰錢的合法邊：
--   searching → matched   （限新獵人本人：舊版搶單後備路徑）
--   searching → cancelled （限發單人：獵人還沒出發，免費取消）
--   matched   → verifying （限該單獵人：回報已解決）
-- 其餘轉移（completed / escaped / 違約取消 / 退回 searching）一律只能走
-- SECURITY DEFINER RPC —— RPC 內 set_config 打交易內暗號，trigger 放行。
-- 這同時堵死「獵人跳過求救者確認、直接把單改成 completed」的漏洞。
-- service_role（管理後台 / pg_cron）的 auth.uid() 為 null → 完全不受限。
create or replace function public.guard_order_transition()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then return new; end if;  -- 後台 / 排程
  if new.status is not distinct from old.status then return new; end if;
  if current_setting('app.order_transition', true) = 'rpc' then return new; end if;
  if old.status = 'searching' and new.status = 'matched'
     and new.hunter_id = auth.uid() then return new; end if;
  if old.status = 'searching' and new.status = 'cancelled'
     and auth.uid() = old.client_id then return new; end if;
  if old.status = 'matched' and new.status = 'verifying'
     and auth.uid() = old.hunter_id then return new; end if;
  raise exception 'status transition % -> % not allowed', old.status, new.status;
end;
$$;

drop trigger if exists trg_guard_order_transition on public.orders;
create trigger trg_guard_order_transition
  before update on public.orders
  for each row
  execute function public.guard_order_transition();

-- ── (3a) 既有 RPC 補上交易內暗號（整支重建，商業邏輯不變）───────────
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
  perform set_config('app.order_transition', 'rpc', true);
  update public.orders
     set status = 'searching', hunter_id = null,
         hunter_lat = null, hunter_lng = null, matched_at = null
   where id = p_order_id;
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
  where id = p_order_id
  for update;
  if not found then
    raise exception 'order not found';
  end if;
  if auth.uid() is distinct from v_hunter then
    raise exception 'only the matched hunter can settle this order';
  end if;
  if v_status <> 'matched' then
    raise exception 'order is not in matched state (current: %)', v_status;
  end if;
  v_refund := greatest(v_price - v_fee, 0);
  perform set_config('app.order_transition', 'rpc', true);
  update public.orders set status = 'escaped' where id = p_order_id;
  update public.profiles set wallet_balance = wallet_balance + v_fee where id = v_hunter;
  if v_client is not null and v_refund > 0 then
    update public.profiles set wallet_balance = wallet_balance + v_refund where id = v_client;
  end if;
end;
$$;
grant execute on function public.settle_escaped(uuid) to authenticated;

-- ── (4) 中途取消違約金 RPC ──────────────────────────────────────────
-- 獵人已出發（matched）時求救者取消：$100 出勤補償金轉入獵人錢包，
-- 預付款其餘退回求救者儲值金。單一交易原子完成，行鎖防止與結案/撲空互撞。
create or replace function public.cancel_matched_order(p_order_id uuid)
returns jsonb
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
  v_penalty constant integer := 100; -- 出勤補償金（與 App 端 CANCEL_PENALTY 一致）
begin
  select client_id, hunter_id, coalesce(price, 0), status
    into v_client, v_hunter, v_price, v_status
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
  v_refund := greatest(v_price - v_penalty, 0);
  perform set_config('app.order_transition', 'rpc', true);
  update public.orders set status = 'cancelled' where id = p_order_id;
  if v_hunter is not null then
    update public.profiles set wallet_balance = wallet_balance + v_penalty where id = v_hunter;
  end if;
  if v_refund > 0 then
    update public.profiles set wallet_balance = wallet_balance + v_refund where id = v_client;
  end if;
  return jsonb_build_object('ok', true, 'penalty', v_penalty, 'refund', v_refund);
end;
$$;
grant execute on function public.cancel_matched_order(uuid) to authenticated;

-- ── (5) 雙重確認結案 RPC ────────────────────────────────────────────
-- 只有求救者本人、且訂單在 verifying（獵人已回報解決）時能結案。
-- 結案 = 狀態改 completed + 獵人錢包入帳 85% 淨收益 + 完成數 +1（推等級），
-- 完成數改由 DB 端累加 → 即使獵人 App 已關閉，酬勞與等級照樣到位。
create or replace function public.confirm_completion(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_hunter uuid;
  v_price  integer;
  v_status text;
  v_net    integer;
begin
  select client_id, hunter_id, coalesce(price, 0), status
    into v_client, v_hunter, v_price, v_status
  from public.orders where id = p_order_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if auth.uid() is distinct from v_client then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_status <> 'verifying' then
    return jsonb_build_object('ok', false, 'reason', 'not_verifying');
  end if;
  v_net := round(v_price * 0.85); -- 與 App 端 netEarning() 一致
  perform set_config('app.order_transition', 'rpc', true);
  update public.orders set status = 'completed' where id = p_order_id;
  if v_hunter is not null then
    update public.profiles
       set wallet_balance  = wallet_balance + v_net,
           completed_tasks = completed_tasks + 1
     where id = v_hunter;
  end if;
  return jsonb_build_object('ok', true, 'net', v_net);
end;
$$;
grant execute on function public.confirm_completion(uuid) to authenticated;

-- ── (6) verifying 期間的權限延續 ────────────────────────────────────
-- 獵人在「等待確認」期間仍可能在現場與求救者溝通 → 地址與聊天不能斷。
drop policy if exists "owner or matched hunter reads order_private" on public.order_private;
create policy "owner or matched hunter reads order_private"
  on public.order_private for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.client_id = auth.uid()
             or (o.hunter_id = auth.uid() and o.status in ('matched', 'verifying')))
    )
  );

drop policy if exists "order parties read messages" on public.messages;
create policy "order parties read messages"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.client_id = auth.uid()
             or (o.hunter_id = auth.uid() and o.status in ('matched', 'verifying', 'completed')))
    )
  );

drop policy if exists "order parties send messages" on public.messages;
create policy "order parties send messages"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.status in ('matched', 'verifying')
        and (o.client_id = auth.uid() or o.hunter_id = auth.uid())
    )
  );

-- （選用）求救者失聯保護：verifying 超過 24 小時自動視為確認結案，
-- 獵人不會因為對方不按確認而永遠拿不到酬勞。啟用 pg_cron 後取消註解跑一次。
-- select cron.schedule('auto-confirm-verifying', '0 * * * *', $c$
--   with done as (
--     update public.orders
--        set status = 'completed'
--      where status = 'verifying'
--        and matched_at < now() - interval '24 hours'
--      returning hunter_id, coalesce(price, 0) as price
--   )
--   update public.profiles p
--      set wallet_balance  = p.wallet_balance + round(d.price * 0.85)::int,
--          completed_tasks = p.completed_tasks + 1
--     from done d
--    where p.id = d.hunter_id;
-- $c$);

-- ═══════════════════════════════════════════════════════════════════
-- 第十七階段：儲值金帳本 + 取消原因（金流透明化）
-- ═══════════════════════════════════════════════════════════════════
-- 痛點：wallet_balance 只是一個整數，錢怎麼來的沒有逐筆帳 → 有爭議無法對帳。
-- 解法：每一次動到 wallet_balance 都同一交易寫一列 wallet_transactions。
-- 錢包目前「只進不出」（撲空退款 / 中途取消退款 / 結案酬勞 / 出勤補償），
-- 故 amount 一律正數；未來若加「用儲值金折抵訂單」再引入負數即可。

create table if not exists public.wallet_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  order_id   uuid references public.orders(id) on delete set null,
  kind       text not null, -- task_payout / escape_fee / escape_refund / cancel_penalty / cancel_refund / adjustment
  amount     integer not null, -- 對 wallet_balance 的變化量（目前皆為正）
  memo       text,
  created_at timestamptz not null default now()
);
create index if not exists wallet_tx_user_idx
  on public.wallet_transactions (user_id, created_at desc);

alter table public.wallet_transactions enable row level security;
-- 只讀自己的帳；沒有 insert policy → 一般使用者無法自行記帳，
-- 只有下方 SECURITY DEFINER 的結算 RPC（繞過 RLS）與後台 service_role 能寫。
drop policy if exists "read own wallet tx" on public.wallet_transactions;
create policy "read own wallet tx"
  on public.wallet_transactions for select
  to authenticated
  using (user_id = auth.uid());

-- 取消原因：區分「媒合前免費取消」與「已出發中途取消（收 $100）」，
-- 讓歷史頁能正確標示、獵人看得到自己賺到的出勤補償。
alter table public.orders add column if not exists cancel_reason text;

-- ── 三支結算 RPC 整支重建：加寫帳本（商業邏輯與金額不變）──────────────
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
  from public.orders where id = p_order_id
  for update;
  if not found then
    raise exception 'order not found';
  end if;
  if auth.uid() is distinct from v_hunter then
    raise exception 'only the matched hunter can settle this order';
  end if;
  if v_status <> 'matched' then
    raise exception 'order is not in matched state (current: %)', v_status;
  end if;
  v_refund := greatest(v_price - v_fee, 0);
  perform set_config('app.order_transition', 'rpc', true);
  update public.orders set status = 'escaped' where id = p_order_id;
  -- 獵人 +車馬費
  update public.profiles set wallet_balance = wallet_balance + v_fee where id = v_hunter;
  insert into public.wallet_transactions (user_id, order_id, kind, amount, memo)
    values (v_hunter, p_order_id, 'escape_fee', v_fee, '撲空車馬費');
  -- 求救者退差額
  if v_client is not null and v_refund > 0 then
    update public.profiles set wallet_balance = wallet_balance + v_refund where id = v_client;
    insert into public.wallet_transactions (user_id, order_id, kind, amount, memo)
      values (v_client, p_order_id, 'escape_refund', v_refund, '撲空退款・差額退儲值金');
  end if;
end;
$$;
grant execute on function public.settle_escaped(uuid) to authenticated;

create or replace function public.cancel_matched_order(p_order_id uuid)
returns jsonb
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
  v_penalty constant integer := 100; -- 出勤補償金
begin
  select client_id, hunter_id, coalesce(price, 0), status
    into v_client, v_hunter, v_price, v_status
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
  v_refund := greatest(v_price - v_penalty, 0);
  perform set_config('app.order_transition', 'rpc', true);
  update public.orders
     set status = 'cancelled', cancel_reason = 'client_cancelled_matched'
   where id = p_order_id;
  if v_hunter is not null then
    update public.profiles set wallet_balance = wallet_balance + v_penalty where id = v_hunter;
    insert into public.wallet_transactions (user_id, order_id, kind, amount, memo)
      values (v_hunter, p_order_id, 'cancel_penalty', v_penalty, '求救者中途取消・出勤補償');
  end if;
  if v_refund > 0 then
    update public.profiles set wallet_balance = wallet_balance + v_refund where id = v_client;
    insert into public.wallet_transactions (user_id, order_id, kind, amount, memo)
      values (v_client, p_order_id, 'cancel_refund', v_refund, '中途取消・差額退儲值金');
  end if;
  return jsonb_build_object('ok', true, 'penalty', v_penalty, 'refund', v_refund);
end;
$$;
grant execute on function public.cancel_matched_order(uuid) to authenticated;

create or replace function public.confirm_completion(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_hunter uuid;
  v_price  integer;
  v_status text;
  v_net    integer;
begin
  select client_id, hunter_id, coalesce(price, 0), status
    into v_client, v_hunter, v_price, v_status
  from public.orders where id = p_order_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if auth.uid() is distinct from v_client then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_status <> 'verifying' then
    return jsonb_build_object('ok', false, 'reason', 'not_verifying');
  end if;
  v_net := round(v_price * 0.85); -- 與 App 端 netEarning() 一致
  perform set_config('app.order_transition', 'rpc', true);
  update public.orders set status = 'completed' where id = p_order_id;
  if v_hunter is not null then
    update public.profiles
       set wallet_balance  = wallet_balance + v_net,
           completed_tasks = completed_tasks + 1
     where id = v_hunter;
    insert into public.wallet_transactions (user_id, order_id, kind, amount, memo)
      values (v_hunter, p_order_id, 'task_payout', v_net, '任務完成酬勞');
  end if;
  return jsonb_build_object('ok', true, 'net', v_net);
end;
$$;
grant execute on function public.confirm_completion(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 第十八階段：信任與安全（檢舉 / 封鎖 / 爭議申訴）
-- ═══════════════════════════════════════════════════════════════════
-- O2O 陌生人上門服務的信任底線：能檢舉、能封鎖對方避免再媒合、能對有問題的
-- 訂單申訴讓客服介入。三張表都只開「本人相關」的最小 RLS，稽核與裁決在後台
-- 用 service_role 進行。

-- ── (1) 檢舉：寫給後台審核，一般人只讀得到自己送出的 ──────────────────
create table if not exists public.user_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  reason      text,
  status      text not null default 'open'
                check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at  timestamptz not null default now()
);
create index if not exists user_reports_status_idx on public.user_reports (status, created_at desc);
alter table public.user_reports enable row level security;

drop policy if exists "insert own report" on public.user_reports;
create policy "insert own report"
  on public.user_reports for insert to authenticated
  with check (reporter_id = auth.uid() and reported_id <> auth.uid());

drop policy if exists "read own report" on public.user_reports;
create policy "read own report"
  on public.user_reports for select to authenticated
  using (reporter_id = auth.uid());

-- ── (2) 封鎖：雙向影響媒合（任一方封鎖，獵人就看不到對方的單）────────────
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table public.blocks enable row level security;

-- 讀：與我相關的兩個方向都要看得到，App 端才能做「雙向過濾」
drop policy if exists "read blocks involving me" on public.blocks;
create policy "read blocks involving me"
  on public.blocks for select to authenticated
  using (blocker_id = auth.uid() or blocked_id = auth.uid());

-- 寫 / 刪：只能操作自己發起的封鎖，且不能封鎖自己
drop policy if exists "write own blocks" on public.blocks;
create policy "write own blocks"
  on public.blocks for all to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid() and blocked_id <> auth.uid());

-- ── (3) 爭議申訴：訂單當事人對自己參與的單提出，款項先保留待客服裁決 ─────
create table if not exists public.disputes (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  raised_by  uuid not null references public.profiles(id) on delete cascade,
  reason     text,
  status     text not null default 'open'
               check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists disputes_status_idx on public.disputes (status, created_at desc);
create index if not exists disputes_order_idx on public.disputes (order_id);
alter table public.disputes enable row level security;

drop policy if exists "party raises dispute" on public.disputes;
create policy "party raises dispute"
  on public.disputes for insert to authenticated
  with check (
    raised_by = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.client_id = auth.uid() or o.hunter_id = auth.uid())
    )
  );

drop policy if exists "read own dispute" on public.disputes;
create policy "read own dispute"
  on public.disputes for select to authenticated
  using (raised_by = auth.uid());

-- ═══════════════════════════════════════════════════════════════════
-- 第十九階段：營運自動化 + 濫用防護 + 資料保留（上線前加固）
-- ═══════════════════════════════════════════════════════════════════
-- 目標：讓訂單不會卡死、地址不會永久留存、同一人不會灌爆任務池。
-- 三支維護工作寫成 SECURITY DEFINER 函式（可手動呼叫測試），再用 pg_cron 排程。
-- 函式一律 revoke 掉 authenticated → 只有排程(postgres)與後台 service_role 能跑。

-- ── (1) 逾時未確認自動結案：verifying 超過 24h → completed 並撥款 ────
-- 保護獵人：求救者失聯不按確認，酬勞照樣入帳。金流與 confirm_completion 一致，
-- 同一 hunter 若有多張同時到期，錢包/完成數以「加總 / 計數」一次更新（不漏算）。
create or replace function public.job_auto_confirm_verifying()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with done as (
    update public.orders set status = 'completed'
     where status = 'verifying'
       and matched_at is not null
       and matched_at < now() - interval '24 hours'
     returning id, hunter_id, coalesce(price, 0) as price
  ),
  agg as (
    select hunter_id, sum(round(price * 0.85))::int as total, count(*) as cnt
    from done where hunter_id is not null group by hunter_id
  ),
  pay as (
    update public.profiles p
       set wallet_balance = p.wallet_balance + a.total,
           completed_tasks = p.completed_tasks + a.cnt
      from agg a where p.id = a.hunter_id returning 1
  )
  insert into public.wallet_transactions (user_id, order_id, kind, amount, memo)
  select hunter_id, id, 'task_payout', round(price * 0.85)::int, '任務完成酬勞（逾時自動確認）'
  from done where hunter_id is not null and round(price * 0.85) > 0;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── (2) 無人接單自動過期：searching 超過 24h → cancelled（無金流，未媒合）──
create or replace function public.job_expire_stale_searching()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.orders set status = 'cancelled', cancel_reason = 'auto_expired_unmatched'
   where status = 'searching' and created_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end $$;

-- ── (3) 隱私保留策略：結案 30 天後清掉精確地址 / 進入指引 ────────────
create or replace function public.job_purge_old_private()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.order_private op
     set exact_address = null, entry_instructions = null
    from public.orders o
   where op.order_id = o.id
     and o.status in ('completed', 'cancelled', 'escaped')
     and o.created_at < now() - interval '30 days'
     and (op.exact_address is not null or op.entry_instructions is not null);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.job_auto_confirm_verifying() from public, authenticated;
revoke all on function public.job_expire_stale_searching() from public, authenticated;
revoke all on function public.job_purge_old_private() from public, authenticated;

-- ── (4) 濫用防護：同一 client 同時只能有一張 searching 單 ─────────────
-- 先把重複的舊 searching 單收斂成「只留最新一張」，其餘標記取消，才能建唯一索引。
update public.orders o set status = 'cancelled', cancel_reason = 'dedup_multiple_searching'
 where status = 'searching'
   and exists (
     select 1 from public.orders n
     where n.client_id = o.client_id and n.status = 'searching' and n.created_at > o.created_at
   );
create unique index if not exists orders_one_active_searching
  on public.orders (client_id) where status = 'searching';

-- ── (5) pg_cron 啟用 + 排程（若專案未開 pg_cron，函式仍在、只是沒自動跑）──
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron 自動啟用失敗（%）。到 Dashboard→Database→Extensions 手動啟用後重跑本檔即可。', sqlerrm;
end $$;

do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if found then
    perform cron.schedule('auto-confirm-verifying', '*/30 * * * *',
      'select public.job_auto_confirm_verifying();');
    perform cron.schedule('expire-stale-searching', '15 * * * *',
      'select public.job_expire_stale_searching();');
    perform cron.schedule('purge-old-private', '30 3 * * *',
      'select public.job_purge_old_private();');
  else
    raise notice 'pg_cron 未啟用：維護函式已建立但尚未排程，啟用擴充後重跑本檔即會自動排程。';
  end if;
end $$;

-- ── (選用) 孤兒 matched 單自動回收：故意預設關閉 ─────────────────────
-- 為什麼不預設開：45 分鐘就把 matched 打回任務池，會誤殺「合理進行中的長工單」，
-- 造成同一張單被重複派給兩位獵人。獵人失聯的常見情況已由 report_no_show（20 分寬限、
-- 求救者觸發）處理。若你要開「雙方都失聯」的長時保底，取消下面註解並自行調整時數：
-- do $$ begin
--   if exists (select 1 from pg_extension where extname='pg_cron') then
--     perform cron.schedule('reclaim-orphan-matched','*/30 * * * *', $c$
--       update public.orders set status='searching', hunter_id=null,
--              hunter_lat=null, hunter_lng=null, matched_at=null
--        where status='matched' and matched_at < now() - interval '3 hours';
--     $c$);
--   end if;
-- end $$;
