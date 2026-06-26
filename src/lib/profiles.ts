import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { type Role } from '@/store/useAppStore';

/** 對應 SQL 的 public.profiles 一列 */
export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  rating: number;
  completed_tasks: number;
}

/** 兩種身分的預設名稱（也用來判斷名稱是否「仍是未自訂的預設值」）*/
export const DEFAULT_NAMES: Record<Role, string> = {
  requester: '鎮宅金主',
  hunter: '見習獵人',
};
const ALL_DEFAULTS = Object.values(DEFAULT_NAMES);

/** numeric 欄位可能以字串回傳，統一轉成 number */
function mapRow(data: {
  id: string;
  display_name: string;
  avatar_url: string | null;
  rating: number | string;
  completed_tasks: number | string;
}): Profile {
  return {
    id: data.id,
    display_name: data.display_name,
    avatar_url: data.avatar_url ?? null,
    rating: Number(data.rating),
    completed_tasks: Number(data.completed_tasks),
  };
}

/**
 * 登入 / 進入某身分時確保有一筆 profile：
 * - 不存在 → 建立該身分的預設名稱
 * - 已存在但名稱仍是「未自訂的預設值」且與當前身分不符 → 同步成對應預設
 * - 名稱已被使用者自訂 → 不動
 * profiles 表尚未建立或任何錯誤時靜默退出（前端會用 fallback 名稱）。
 */
export async function ensureProfile(userId: string | null, role: Role): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !userId) return;
  const wanted = DEFAULT_NAMES[role];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) return; // 例如 profiles 表尚未建立
  if (!data) {
    await supabase.from('profiles').insert({ id: userId, display_name: wanted });
    return;
  }
  if (ALL_DEFAULTS.includes(data.display_name) && data.display_name !== wanted) {
    await supabase.from('profiles').update({ display_name: wanted }).eq('id', userId);
  }
}

/** 讀取單一使用者的 profile（不存在 / 未設定 Supabase 時回 null）*/
export async function fetchProfile(userId: string | null): Promise<Profile | null> {
  if (!isSupabaseConfigured || !supabase || !userId) return null;
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, rating, completed_tasks')
    .eq('id', userId)
    .maybeSingle();
  return data ? mapRow(data) : null;
}
