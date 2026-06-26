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
  created_at    timestamptz not null default now()
);

create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_client_idx on public.orders (client_id);

-- ── Row Level Security ─────────────────────────────────────────────
alter table public.orders enable row level security;

-- 求救者只能建立 client_id = 自己 的訂單
create policy "clients insert own orders"
  on public.orders for insert
  to authenticated
  with check (auth.uid() = client_id);

-- 看得到：自己發的單、尚在徵人的單(searching)、或自己接的單
create policy "read own or open orders"
  on public.orders for select
  to authenticated
  using (
    auth.uid() = client_id
    or status = 'searching'
    or auth.uid() = hunter_id
  );

-- 更新：自己是 client / hunter，或正在接一張 searching 的單
create policy "update own or accepting orders"
  on public.orders for update
  to authenticated
  using (auth.uid() = client_id or auth.uid() = hunter_id or status = 'searching')
  with check (true);

-- ── Realtime ───────────────────────────────────────────────────────
-- 讓前端能 subscribe 到 UPDATE；full 可讓事件帶完整列資料
alter table public.orders replica identity full;
alter publication supabase_realtime add table public.orders;

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
  updated_at      timestamptz not null default now()
);

-- ── Row Level Security ─────────────────────────────────────────────
alter table public.profiles enable row level security;

-- 所有登入者都能讀任何人的 profile（要看到對方名稱 / 評分）
create policy "profiles readable by authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- 只能建立 id = 自己 的 profile（upsert 的 insert 分支）
create policy "users insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- 只能更新自己的 profile
create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
