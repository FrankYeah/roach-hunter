/**
 * 「乾，有那個啦」品牌用語與規格常數
 * 嚴格遵守視覺避諱：全程不出現任何蟲體字眼，一律以「那個 / 目標 / 訪客」代稱。
 */

export const BRAND = {
  appName: '乾，出現了！',
  tagline: '穿著夾腳拖，馬上到你家救援',
  /** 首頁巨大呼救按鈕文案（不可更動） */
  sosLabel: '乾，出現了！',
  /** 呼救者稱號 */
  requesterTitle: '鎮宅金主',
} as const;

/** 獵人等級稱號（由低到高，沿用作 mock 資料的稱號型別） */
export const HUNTER_RANKS = ['拖鞋見習生', '捲報紙達人', '白金殺手'] as const;
export type HunterRank = (typeof HUNTER_RANKS)[number];

/**
 * 經驗等級（依完成任務數）。同一份定義同時驅動三件事：
 *  1) 求救端「獵人等級要求」的動態加價
 *  2) 獵人首頁的等級面板 / 升級進度
 *  3) 任務池派單過濾（completed_tasks >= 訂單 min_completed 才看得到）
 * 徽章質感隨等級提升，最高級「滅蟑大師」採金屬銀。
 */
export type HunterLevelId = 'rookie' | 'skilled' | 'veteran' | 'master';

export interface HunterLevel {
  id: HunterLevelId;
  name: string;
  /** 達到此級所需的最少完成任務數 */
  minCompleted: number;
  /** 求救端指定「至少此級」時的加價（新台幣）*/
  surcharge: number;
  /** 徽章底色 / 文字色（Tailwind class）+ icon（MaterialCommunityIcons）*/
  badge: string;
  text: string;
  icon: string;
}

export const HUNTER_LEVELS: HunterLevel[] = [
  { id: 'rookie', name: '新手', minCompleted: 0, surcharge: 0, badge: 'bg-wood-100', text: 'text-wood-600', icon: 'shoe-sneaker' },
  { id: 'skilled', name: '熟手', minCompleted: 1, surcharge: 30, badge: 'bg-wood-300', text: 'text-ink', icon: 'shoe-print' },
  { id: 'veteran', name: '老手', minCompleted: 5, surcharge: 50, badge: 'bg-silver-light', text: 'text-silver-dark', icon: 'medal-outline' },
  { id: 'master', name: '滅蟑大師', minCompleted: 20, surcharge: 70, badge: 'bg-silver', text: 'text-white', icon: 'crown' },
];

/** 由完成任務數推導目前等級（取符合的最高門檻）*/
export function levelFromCompleted(completed: number): HunterLevel {
  let lvl = HUNTER_LEVELS[0];
  for (const l of HUNTER_LEVELS) if (completed >= l.minCompleted) lvl = l;
  return lvl;
}

/** 下一個等級（已達頂級時為 null）*/
export function nextLevel(completed: number): HunterLevel | null {
  return HUNTER_LEVELS.find((l) => l.minCompleted > completed) ?? null;
}

/** 目標尺寸與指導價（單位：新台幣） */
export interface TargetTier {
  id: 'small' | 'big' | 'flying';
  label: string;
  /** 用「方塊大小」隱喻體型，避免任何蟲體描述 */
  hint: string;
  price: number;
  /** 馬賽克方塊的格數，視覺上越大越多格 */
  mosaic: number;
}

export const TARGET_TIERS: TargetTier[] = [
  { id: 'small', label: '小隻', hint: '指甲大小的黑影', price: 150, mosaic: 2 },
  { id: 'big', label: '大隻', hint: '會讓你倒退三步', price: 180, mosaic: 3 },
  { id: 'flying', label: '會飛的', hint: '在空中亂竄的惡夢', price: 210, mosaic: 4 },
];

/** 若未擊殺 / 目標跑掉，統一收取的車馬費 */
export const CHASE_FEE = 100;

/** 加購服務（MVP 假資料） */
export const ADDONS = [
  { id: 'cleanup', label: '善後清潔', desc: '幫你把「現場」處理乾淨', price: 50 },
  { id: 'patrol', label: '巡邏一圈', desc: '檢查櫥櫃與排水孔死角', price: 80 },
] as const;
