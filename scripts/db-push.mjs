// 把 supabase/schema.sql（或指定的 .sql 檔）套用到 Supabase 資料庫。
//
// 為什麼可以這樣做：schema.sql 全程 idempotent（create ... if not exists /
// create or replace / drop policy if exists / add column if not exists），
// 所以「整份重跑」永遠安全 —— 這支腳本就是把「複製到 SQL Editor 貼上」自動化。
//
// 用法：
//   node scripts/db-push.mjs                 # 套用 supabase/schema.sql
//   node scripts/db-push.mjs path/to/x.sql   # 套用指定檔案
//
// 連線字串放在 .env.local 的 SUPABASE_DB_URL（該檔已被 .gitignore 忽略）。
// 取得方式見 README / 對話說明：Supabase Dashboard → Project Settings →
// Database → Connection string →「Session pooler」的 URI，把 [YOUR-PASSWORD] 換掉。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 從環境變數或 .env.local 取得 SUPABASE_DB_URL */
function getDbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL.trim();
  try {
    const env = readFileSync(resolve(root, '.env.local'), 'utf8');
    const line = env.split('\n').find((l) => l.trim().startsWith('SUPABASE_DB_URL='));
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  } catch {
    /* .env.local 不存在 */
  }
  return null;
}

async function main() {
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    console.error(
      '\n✗ 找不到 SUPABASE_DB_URL。\n' +
        '  請在專案根目錄的 .env.local 加一行：\n' +
        '  SUPABASE_DB_URL=postgresql://postgres.<ref>:<密碼>@<pooler-host>:5432/postgres\n' +
        '  （Supabase Dashboard → Project Settings → Database → Connection string → Session pooler）\n',
    );
    process.exit(1);
  }

  const file = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(root, 'supabase/schema.sql');
  const sql = readFileSync(file, 'utf8');
  console.log(`→ 套用 ${file.replace(root + '/', '')} 到 Supabase…`);

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }, // Supabase 一律走 SSL
  });

  await client.connect();
  try {
    // 整份包在單一交易：任一句失敗就整體 rollback，資料庫不會停在半套狀態。
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log('✓ 套用成功（單一交易，已 commit）。');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error('\n✗ 套用失敗，已整體 rollback。錯誤：\n  ' + (e?.message ?? e));
    if (e?.position) console.error('  （position: ' + e.position + '）');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
