# 「那個，出現了！」訂單管理後台 — 規格書

> 這份文件是給「另一個資料夾、另一個 Claude」用來從零打造**管理後台**的完整規格。
> 後台與 App 共用同一個 Supabase 專案，部署在 Zeabur，用來管理訂單、使用者、KYC 審核與錢包。
>
> **怎麼用**：把第 7 節的 Prompt 整段複製給新的 Claude session 即可開工；第 1–6 節是
> 人類參考用的背景與決策註解（含「為什麼這樣設計」），日後要改需求時回來看這裡。
>
> 最後更新：2026-06（App 已完成到第十三階段）。

---

## 0. 一分鐘背景

`roach-hunter` 是一個 O2O 媒合 App：**求救者**發單請人來家裡處理「那個（目標）」，**獵人**搶單上門解決。
React Native / Expo SDK 54 前端 + Supabase（Postgres + Auth + Realtime + Storage）後端。

- App 端用 **anon key**，受 Row Level Security (RLS) 保護 → 每個使用者只看得到自己的資料。
- 這個後台要做的是**平台管理員視角**：看光所有訂單、所有人、所有聊天、改狀態、審 KYC、調錢包。
- 因此後台**不能**用 anon key（會被 RLS 擋），必須用 **service_role key**（見第 2 節）。

---

## 1. 技術選型（Claude 最擅長 + Zeabur 友善）

| 項目 | 選擇 | 為什麼 |
|---|---|---|
| 框架 | **Next.js 15 (App Router) + TypeScript** | Claude 對它最熟、全端一體（同一個 repo 既是 UI 又是 API）、Zeabur 一鍵偵測部署 |
| 樣式 | **Tailwind CSS + shadcn/ui** | 後台大量表格/表單/對話框，shadcn 直接抄現成元件最快、外觀乾淨 |
| 資料層 | **`@supabase/supabase-js`（server 端用 service_role）** | 不另外接 ORM；後台量體小，直接打 Supabase 最省事。見第 2 節安全模型 |
| 登入 | **Supabase Auth (email/password) + email 白名單** | 復用同一個 Supabase 專案的 Auth，不用自建使用者系統；白名單確保只有管理員進得來 |
| 部署 | **Zeabur** | 你指定的平台，對 Next.js 有原生支援 |

> 💡 **登入方式的替代方案**：若覺得「用 Supabase Auth 還要先建一個管理員帳號」太麻煩，
> 可改成最陽春的 **單一 `ADMIN_PASSWORD` + 簽章 cookie（iron-session）**。兩種都安全，
> 差別只在要不要在 Supabase 後台先開一個 admin 使用者。本規格預設走「白名單」。

---

## 2. ⚠️ 安全模型（整份文件最重要的一段）

### 2.1 為什麼一定要用 service_role
App 端的 anon key 受 RLS 限制，例如 `orders` 的 select policy 是
「`auth.uid() = client_id` 或 `status = 'searching'` 或 `auth.uid() = hunter_id`」。
也就是說 **anon key 永遠看不到「別人已完成的單」**。後台要列出所有人的所有訂單，
就必須用 **`service_role` key**——它會**繞過所有 RLS**，等同資料庫 god mode。

### 2.2 service_role 的鐵則
- **絕對不能進瀏覽器。** 環境變數**不要**加 `NEXT_PUBLIC_` 前綴（加了就會被打包進前端 bundle）。
- **只在伺服器端使用**：server component、route handler、server action 裡才 new 出這個 client。
- 因為 service_role = 看光所有人地址、聊天、錢包餘額，所以**整個後台都要登入才能進**。

### 2.3 登入閘門
- 用 Supabase Auth 的 email/password 登入（client 端用 **anon key** 做這件事就好）。
- 登入成功後，**middleware 檢查該 email 是否在 `ADMIN_EMAILS` 白名單**；不在就踢出。
- 為什麼要白名單：App 的求救者/獵人也是 Supabase Auth 使用者，沒有白名單的話他們也能登入後台。

### 2.4 資料存取分工（重點圖）
```
瀏覽器 ──(anon key, 只做登入)──► Supabase Auth
   │
   ▼ 帶著 session cookie
Next.js Server ──(service_role key, 繞過 RLS)──► Postgres / Storage  ← 所有 CRUD 在這層
```

---

## 3. 環境變數清單

| 變數 | 放哪 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase 專案 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | **只給登入**用的 anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | god mode，所有資料讀寫。**絕不可加 NEXT_PUBLIC** |
| `ADMIN_EMAILS` | server | 逗號分隔的管理員 email 白名單 |

> **去哪拿**：Supabase Dashboard → Settings → API，可拿到 `Project URL`、`anon public`、`service_role secret`。
> 管理員帳號：Authentication → Users → Add user 建一個，再把那個 email 填進 `ADMIN_EMAILS`。

---

## 4. 資料字典（後台要操作的表）

> 所有 `*_id`（`client_id` / `hunter_id` / `sender_id` / `rater_id` / `ratee_id`）都指向 `auth.users.id`。
> 要把 UUID 變成人看得懂的名字/email：join `profiles.display_name`，或用
> `supabase.auth.admin.listUsers()`（service role 才有的 Admin API）拿 email。

### `orders` — 後台主角
| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid | 主鍵 |
| `client_id` | uuid | 發單的求救者（→ auth.users） |
| `hunter_id` | uuid \| null | 接單的獵人；searching 階段為 null |
| `target_size` | text | `小` / `大` / `飛`（目標大小，飛 = 會飛的） |
| `status` | text | `searching` / `matched` / `verifying`(獵人回報已解決，待求救者確認) / `completed` / `cancelled` / `escaped`(撲空) |
| `price` | int | 求救者預付總額（已含工具費/VIP 等，由 App 算好寫入） |
| `gender_pref` | text | 求救者對獵人的性別偏好 `any` / `male` / `female` |
| `min_completed` | int | 要求獵人最低完成單數 |
| `needs_tools` | bool | 是否請獵人自備工具（true 加收工具費） |
| `is_vip` | bool | VVIP 急件；**由 DB trigger 依「該 client 完成 ≥10 單」自動判定**，後台唯讀 |
| `location_lat/lng` | float8 | 求救者家的座標 |
| `hunter_lat/lng` | float8 | 獵人接單當下座標（算 ETA 用） |
| `matched_at` | timestamptz \| null | 媒合成功時間（爽約 20 分鐘寬限期的計時起點） |
| `created_at` | timestamptz | 建單時間 |

### `order_private` — 敏感資料（糾紛查證才看）
| 欄位 | 說明 |
|---|---|
| `order_id` | 對應 orders.id |
| `exact_address` | 精確門牌（App 為了隱私把它從 orders 拆出來，RLS 鎖死，只有本人/已媒合獵人讀得到） |
| `entry_instructions` | 進入指引（門禁密碼等） |

> 後台用 service role 可直接讀，方便客服處理「獵人找不到地址」之類的糾紛。

### `profiles` — 使用者管理 + KYC + 錢包
| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid | = auth.users.id |
| `display_name` | text | 暱稱（預設「求救者」/「見習獵人」） |
| `avatar_url` | text \| null | 頭像 |
| `rating` | numeric | 平均星數（由評價 RPC 重算，後台唯讀即可） |
| `completed_tasks` | int | 完成單數（推導等級/VVIP） |
| `gender` | text | `male` / `female` / `unspecified` |
| `id_verification_status` | text | KYC：`none` / `pending` / `verified` / `rejected` |
| `police_verification_status` | text | 良民證（選填加分），同上四種狀態 |
| `search_radius_km` | int | 獵人自訂接單半徑 |
| `default_location_name` | text \| null | 求救者預存的模糊地址基底 |
| `wallet_balance` | int | 虛擬錢包餘額（撲空退款/超收儲值金），**後台可手動調整** |
| `is_online` | bool | 獵人上線接單開關；false = 休息中（不收新單推播，仍可主動接單） |
| `no_show_count` | int | 獵人被回報「逾時未到場」累積次數（3 次自動停權 24h） |
| `suspended_until` | timestamptz \| null | 停權到期時間；> now() 表示接單被封鎖中，**後台可清空解封** |
| `updated_at` | timestamptz | 更新時間 |

### `ratings` — 評價稽核
`id, order_id, rater_id, ratee_id, stars(1–5), created_at`（同一張單同一評價者唯一）。後台唯讀稽核用。

### `messages` — 聊天記錄（糾紛查證）
`id, order_id, sender_id, content, created_at`。依 `order_id` 撈出整串對話。

### `push_tokens` — 推播權杖（敏感，後台不要顯示 token 本身）
`user_id(pk), token, lat, lng, updated_at`。Expo push token + 使用者最後已知位置。
- token 可直接對 Expo Push API 發推播 → **視同機密**，後台介面只顯示「有/無」即可。
- 未來後台若要做「平台公告推播」，在 server 端讀這張表打 `https://exp.host/--/api/v2/push/send`。
- App 端事件推播（新單廣播/獵人出發/新訊息）由 Supabase Edge Function `notify` 負責，後台不用管。

### Storage bucket `verifications`（私有）— KYC 證件照
- 路徑慣例：`{userId}/id.jpg`（身分證件）、`{userId}/police.jpg`（良民證）。
- bucket 是**私有**的，後台要看必須用 **`createSignedUrl` 產生短期連結**，不可做成公開 URL。

---

## 5. 金流規則（後台顯示要與 App 完全一致）

| 規則 | 算式 | 註解 |
|---|---|---|
| 平台抽成 15% | `平台費 = price - netEarning` | 用減法不要 `round(price*0.15)`，避免與下面四捨五入對不上 |
| 獵人淨收益 | `netEarning = round(price * 0.85)` | App 端 `netEarning()` 就是這條 |
| 撲空車馬費 | 固定 `$150` | 獵人 +150；求救者退 `max(price-150, 0)` 進 `wallet_balance` |
| 中途取消違約金 | 固定 `$100` | matched 時求救者取消（`cancel_matched_order` RPC）：獵人 +100；求救者退 `max(price-100, 0)`。searching 取消免費、不涉金流 |
| 結案撥款 | `+netEarning` 進獵人錢包 | 求救者按「確認完成」（`confirm_completion` RPC）時：獵人 `wallet_balance +85%`、`completed_tasks +1` |
| VVIP | `is_vip` 由 DB trigger 算 | 後台**只顯示不修改** |

> ⚠️ **後台不要呼叫 App 的 RPC**（`settle_escaped` / `submit_rating` / `cancel_matched_order` /
> `confirm_completion`），那些函式內部綁 `auth.uid()`，後台的 service role 沒有 user 身分會驗證失敗。
> 後台一律用 service role **直接 `update` orders / profiles**（要補錢包就直接改 `wallet_balance`）。
> orders 有「狀態轉移守衛 trigger」，但 service role（auth.uid() 為 null）不受限，強制改單照常可用。

---

## 6. 後台功能（建議 6 個畫面）

1. **登入頁** — Supabase Auth email/password + 白名單把關。
2. **Dashboard 總覽** — 各狀態單數、今日新單、完成單 GMV（sum price where completed）、
   平台費收入(15%)、撲空數、待審 KYC 數、總用戶數。
3. **訂單列表** — 篩選（狀態 / 日期區間 / VIP）、搜尋 id；
   詳情頁：join 出雙方名字+email、金流明細、`order_private` 精確地址與進入指引、該單 `messages` 對話串；
   動作：改 `status`（強制取消 / 標記完成）。
4. **使用者列表** — 搜尋、詳情；可手動調整 `wallet_balance`（退款/補償，須填原因）；
   可解除停權（`suspended_until` 清成 null、視情況歸零 `no_show_count`）。
5. **KYC 審核佇列** — 篩 `id_verification_status='pending'` 或 `police_verification_status='pending'`；
   用 signed URL 顯示證件照 → 「通過」設 `verified`、「退件」設 `rejected`。
6. **（選用）操作稽核** — 見下方 SQL，記錄管理員所有動作。

### 6.1（選用）操作稽核表 — 想留軌跡再在 Supabase SQL Editor 跑
```sql
create table if not exists public.admin_actions (
  id          uuid primary key default gen_random_uuid(),
  admin_email text not null,
  action      text not null,          -- 'order_status' | 'wallet_adjust' | 'kyc_review' ...
  target_id   uuid,                   -- order_id 或 user_id
  detail      jsonb,                  -- { from, to, amount, reason ... }
  created_at  timestamptz not null default now()
);
-- 開 RLS 但不建任何 policy → anon/authenticated 都碰不到，只有 service_role 能讀寫
alter table public.admin_actions enable row level security;
```

---

## 7. 📋 給另一個 Claude 的完整 Prompt（整段複製貼上）

```markdown
我要做一個「訂單管理後台」，管理一個既有 React Native App 背後的 Supabase 資料庫。
App 叫「那個，出現了！」——一個媒合「居家除蟲獵人」與「求救者」的 O2O 平台。
請用 Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui 做，最後要部署到 Zeabur。

## 連線與安全（最重要）
- 用 @supabase/supabase-js。App 端用 anon key 受 RLS 限制，但後台要看「所有」資料，
  因此後台所有資料讀寫一律在「伺服器端」用 SUPABASE_SERVICE_ROLE_KEY（繞過 RLS）。
- service_role key 絕對不可進瀏覽器：環境變數不要加 NEXT_PUBLIC 前綴，只在 server
  component / route handler / server action 使用。
- 整個後台用 Supabase Auth (email/password) 登入，並用 middleware 擋未登入；
  只有 email 在 ADMIN_EMAILS 白名單內的帳號能進。登入用 anon key（client 端），
  資料存取用 service role（server 端）。

## 環境變數
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY        # 只給登入用
- SUPABASE_SERVICE_ROLE_KEY            # server only，god mode
- ADMIN_EMAILS                          # 逗號分隔白名單

## 資料表（Supabase / Postgres，欄位如下）
orders: id uuid, client_id uuid, hunter_id uuid, target_size text(小/大/飛),
  status text(searching|matched|verifying|completed|cancelled|escaped), price int,
  # verifying = 獵人回報已解決、待求救者確認結案
  gender_pref text(any|male|female), min_completed int, needs_tools bool,
  is_vip bool, location_lat/lng float8, hunter_lat/lng float8,
  matched_at timestamptz, created_at timestamptz
order_private: order_id uuid, exact_address text, entry_instructions text   # 敏感
profiles: id uuid(=auth.users.id), display_name text, avatar_url text, rating numeric,
  completed_tasks int, gender text, id_verification_status text(none|pending|verified|rejected),
  police_verification_status text(同), search_radius_km int, default_location_name text,
  wallet_balance int, is_online bool, no_show_count int, suspended_until timestamptz,
  updated_at timestamptz
ratings: id, order_id, rater_id, ratee_id, stars int(1-5), created_at
messages: id, order_id, sender_id, content text, created_at
push_tokens: user_id uuid(pk), token text, lat/lng float8, updated_at timestamptz
  # Expo push token，機密：介面只顯示有/無，永遠不要把 token 印在畫面上
Storage bucket 'verifications'（私有）：KYC 證件照，路徑 {userId}/id.jpg、{userId}/police.jpg
client_id / hunter_id / sender_id 都對應 auth.users.id；
要顯示 email/名字時用 supabase.auth.admin.listUsers() 或 join profiles.display_name。

## 金流規則（顯示要與 App 一致）
- 平台抽成 15%：netEarning = round(price*0.85)，平台費 = price - netEarning。
- 撲空車馬費固定 $150：獵人 +150，求救者退 max(price-150,0) 進 wallet_balance。
- 中途取消違約金固定 $100（matched 時取消）：獵人 +100，求救者退 max(price-100,0)。
- 結案（confirm_completion）：獵人 wallet_balance +netEarning、completed_tasks +1。
- is_vip 由 DB 自動判定，後台唯讀顯示即可。

## 要做的畫面
1. 登入頁（Supabase Auth email/password + 白名單）。
2. Dashboard：各狀態單數、今日新單、完成單 GMV、平台費收入、撲空數、待審 KYC 數、總用戶數。
3. 訂單列表：可依 狀態/日期/VIP 篩選、搜尋 id；詳情頁顯示雙方名字+email、金流明細、
   order_private 的精確地址與進入指引、該單 messages 對話串；可改 status（強制取消/標記完成）。
4. 使用者列表：搜尋、詳情；可手動調整 wallet_balance（填原因）；
   可解除停權（suspended_until 清 null、視情況歸零 no_show_count）。
5. KYC 審核佇列：篩 id_verification_status='pending' 或 police_verification_status='pending'，
   用 storage createSignedUrl 顯示證件照，按鈕「通過」→ 設 verified、「退件」→ rejected。
6. （選用）admin_actions 稽核表記錄所有後台操作。

## 約束
- 後台直接用 service role 做 update（不要呼叫 App 的 settle_escaped / submit_rating，那些綁 auth.uid()）。
- 私有 bucket 的證件照一律用後端產生短期 signed URL，不要做成公開連結。
- 介面用繁體中文，沿用「那個，出現了！」品牌名；所有文案禁止直呼目標生物的中文名稱，一律以「那個」或「目標」代稱。
- 最後給我 Zeabur 部署步驟與要設定的環境變數清單。
請先規劃資料夾結構與頁面路由，再逐步實作；每個畫面先能列表、再加篩選、最後加動作按鈕。
```

---

## 8. Zeabur 部署備忘

- Zeabur 會自動偵測 Next.js，build 用 `next build`、start 用 `next start`（Zeabur 注入 `$PORT`）。
- 在 Zeabur 專案的 **Variables** 填入第 3 節四個環境變數（特別注意 `SUPABASE_SERVICE_ROLE_KEY` 是 server 變數）。
- 部署後第一次登入：用你在 Supabase 建的管理員 email/password，確認白名單擋得住非管理員。
