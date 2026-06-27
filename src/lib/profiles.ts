import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { type Role } from '@/store/useAppStore';

export type Gender = 'male' | 'female' | 'unspecified';

/** 對應 SQL 的 public.profiles 一列 */
export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  rating: number;
  completed_tasks: number;
  gender: Gender;
  id_verified: boolean;
  police_verified: boolean;
  /** 獵人自訂接單半徑（公里）。高階特權，預設 2。*/
  search_radius_km: number;
  /** 求救者預存的模糊地址基底（如「夏日公寓」/「安樂區XX街」），發單時當地址底稿。*/
  default_location_name: string | null;
}

/** 兩種身分的預設名稱（也用來判斷名稱是否「仍是未自訂的預設值」）*/
export const DEFAULT_NAMES: Record<Role, string> = {
  requester: '鎮宅金主',
  hunter: '見習獵人',
};
const ALL_DEFAULTS = Object.values(DEFAULT_NAMES);

/** numeric 欄位可能以字串回傳，統一轉成 number；新欄位給安全預設 */
function mapRow(data: {
  id: string;
  display_name: string;
  avatar_url: string | null;
  rating: number | string;
  completed_tasks: number | string;
  gender?: Gender | null;
  id_verified?: boolean | null;
  police_verified?: boolean | null;
  search_radius_km?: number | string | null;
  default_location_name?: string | null;
}): Profile {
  return {
    id: data.id,
    display_name: data.display_name,
    avatar_url: data.avatar_url ?? null,
    rating: Number(data.rating),
    completed_tasks: Number(data.completed_tasks),
    gender: data.gender ?? 'unspecified',
    id_verified: data.id_verified ?? false,
    police_verified: data.police_verified ?? false,
    search_radius_km: data.search_radius_km != null ? Number(data.search_radius_km) : 2,
    default_location_name: data.default_location_name ?? null,
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
    .select(
      'id, display_name, avatar_url, rating, completed_tasks, gender, id_verified, police_verified, search_radius_km, default_location_name',
    )
    .eq('id', userId)
    .maybeSingle();
  return data ? mapRow(data) : null;
}

/** 更新自己的 profile（性別 / 認證狀態 / 接單半徑等）。未設定或欄位未遷移時靜默忽略。*/
export async function updateProfile(
  userId: string | null,
  patch: Partial<
    Pick<
      Profile,
      | 'display_name'
      | 'gender'
      | 'id_verified'
      | 'police_verified'
      | 'search_radius_km'
      | 'default_location_name'
    >
  >,
): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !userId) return;
  await supabase.from('profiles').update(patch).eq('id', userId);
}

/** 完成任務後將自己的 completed_tasks +1（read-modify-write，MVP 夠用）*/
export async function bumpCompletedTasks(userId: string | null): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !userId) return;
  const { data } = await supabase
    .from('profiles')
    .select('completed_tasks')
    .eq('id', userId)
    .maybeSingle();
  const current = data ? Number(data.completed_tasks) : 0;
  await supabase.from('profiles').update({ completed_tasks: current + 1 }).eq('id', userId);
}
