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
