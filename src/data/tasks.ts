import { TARGET_TIERS, type TargetTier } from '@/constants/brand';

/** 平台抽成比例（獵人淨收益 = 訂單金額 × (1 − 此值)） */
export const PLATFORM_FEE_RATE = 0.2;

/** 由訂單金額計算獵人扣除手續費後的淨收益 */
export function netEarning(price: number): number {
  return Math.round(price * (1 - PLATFORM_FEE_RATE));
}

export interface SosTask {
  id: string;
  requesterTitle: string;
  address: string;
  /** 直線距離（公尺） */
  distanceM: number;
  tierId: TargetTier['id'];
  /** 幾分鐘前發出 */
  postedAgoMin: number;
  note: string;
  /** 預估抵達分鐘 */
  etaMin: number;
}

/** 任務池：附近正在呼救的訂單（mock） */
export const SOS_TASKS: SosTask[] = [
  {
    id: 't1',
    requesterTitle: '冷靜的課金大佬',
    address: '夏日公寓 4 樓・客廳',
    distanceM: 220,
    tierId: 'flying',
    postedAgoMin: 1,
    note: '會飛的！在天花板繞圈，拜託快來 😭',
    etaMin: 5,
  },
  {
    id: 't2',
    requesterTitle: '冷靜的課金大佬',
    address: '海風華廈 2 樓・廚房',
    distanceM: 380,
    tierId: 'big',
    postedAgoMin: 3,
    note: '超大隻躲在冰箱後面，不敢開火',
    etaMin: 7,
  },
  {
    id: 't3',
    requesterTitle: '冷靜的課金大佬',
    address: '巷口套房・浴室',
    distanceM: 540,
    tierId: 'small',
    postedAgoMin: 4,
    note: '小隻但我整個人縮在床上',
    etaMin: 9,
  },
  {
    id: 't4',
    requesterTitle: '冷靜的課金大佬',
    address: '綠丘社區 7 樓・陽台',
    distanceM: 760,
    tierId: 'big',
    postedAgoMin: 6,
    note: '在排水孔附近出沒，求支援',
    etaMin: 12,
  },
];

/** 取得任務對應的價目層級（含金額） */
export function tierOf(task: SosTask): TargetTier {
  return TARGET_TIERS.find((t) => t.id === task.tierId)!;
}
