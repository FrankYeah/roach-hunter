/**
 * 「乾，有那個啦」品牌用語與規格常數
 * 嚴格遵守視覺避諱：全程不出現任何蟲體字眼，一律以「那個 / 目標 / 訪客」代稱。
 */

export const BRAND = {
  appName: '乾，有那個啦',
  tagline: '穿著夾腳拖，馬上到你家救援',
  /** 首頁巨大呼救按鈕文案（不可更動） */
  sosLabel: '乾，出現了！',
  /** 呼救者稱號 */
  requesterTitle: '鎮宅金主',
} as const;

/** 獵人等級稱號（由低到高） */
export const HUNTER_RANKS = ['拖鞋見習生', '捲報紙達人', '白金殺手'] as const;
export type HunterRank = (typeof HUNTER_RANKS)[number];

/** 各等級對應的視覺強調樣式（白金殺手＝金屬銀徽章） */
export interface RankStyle {
  badge: string;
  text: string;
  /** MaterialCommunityIcons 名稱 */
  icon: string;
}

export const RANK_STYLE: Record<HunterRank, RankStyle> = {
  拖鞋見習生: { badge: 'bg-wood-100', text: 'text-wood-600', icon: 'shoe-sneaker' },
  捲報紙達人: { badge: 'bg-wood-300', text: 'text-ink', icon: 'newspaper-variant-outline' },
  白金殺手: { badge: 'bg-silver-light', text: 'text-silver-dark', icon: 'medal-outline' },
};

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
