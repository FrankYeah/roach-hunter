-- 「乾，出現了！」 orders 資料表
-- 在 Supabase 後台 → SQL Editor 貼上執行即可。

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references auth.users (id) on delete set null,
  hunter_id     uuid references auth.users (id) on delete set null,
  target_size   text not null check (target_size in ('小', '大', '飛')),
  status        text not null default 'searching'
                  check (status in ('searching', 'matched', 'completed', 'cancelled')),
  location_lat  double precision,
  location_lng  double precision,
  -- 獵人接單當下的座標（讓求救端能算出 hunter→client 的真實距離 / ETA）
  hunter_lat    double precision,
  hunter_lng    double precision,
  price         integer,
  -- 求救者的進階篩選：性別偏好 + 最低經驗（completed_tasks）要求
  gender_pref   text not null default 'any' check (gender_pref in ('any', 'male', 'female')),
  min_completed integer not null default 0,
  -- 精確地址 / 進入指引（隱私：媒合成功前不揭露給其他獵人）
  exact_address       text,
  entry_instructions  text,
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
  check (status in ('searching', 'matched', 'completed', 'cancelled'));

-- 第六階段：替既有 orders 補上獵人座標欄位（idempotent）
alter table public.orders add column if not exists hunter_lat double precision;
alter table public.orders add column if not exists hunter_lng double precision;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  第六階段：使用者檔案 profiles                                      ║
-- ╚══════════════════════════════════════════════════════════════════╝
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  display_name    text not null default '鎮宅金主',
  avatar_url      text,
  rating          numeric not null default 5.0,
  completed_tasks integer not null default 0,
  -- 第七階段：性別 + 認證狀態
  gender          text not null default 'unspecified' check (gender in ('male', 'female', 'unspecified')),
  id_verified     boolean not null default false,
  police_verified boolean not null default false,
  -- 第八階段：獵人自訂接單半徑（公里），高階特權，預設 2
  search_radius_km integer not null default 2,
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
-- ║  第八階段：精確地址 / 隱私 + 獵人自訂接單半徑（idempotent）       ║
-- ╚══════════════════════════════════════════════════════════════════╝
-- orders：精確地址 + 進入指引
alter table public.orders add column if not exists exact_address text;
alter table public.orders add column if not exists entry_instructions text;

-- profiles：獵人自訂接單半徑（公里），預設 2
alter table public.profiles add column if not exists search_radius_km integer not null default 2;
