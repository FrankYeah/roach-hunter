import { HUNTER_RANKS, type HunterRank } from '@/constants/brand';

export interface Hunter {
  id: string;
  name: string;
  rank: HunterRank;
  rating: number;
  /** 已完成任務數 */
  kills: number;
  /** 直線距離（公尺） */
  distanceM: number;
  /** 預計抵達分鐘 */
  etaMin: number;
  /** 是否在線閒置中 */
  online: boolean;
  /** 一句自我介紹（chill 風） */
  blurb: string;
  /** 頭像底色（暫代圖片用色塊） */
  avatarColor: string;
  /**
   * 在地圖上的相對座標（0~1），用來擺放腳丫子圖示。
   * x：左→右，y：上→下。
   */
  map: { x: number; y: number };
}

/** 附近閒置獵人（首頁地圖用 mock data） */
export const NEARBY_HUNTERS: Hunter[] = [
  {
    id: 'h1',
    name: '阿松',
    rank: '白金殺手',
    rating: 4.9,
    kills: 312,
    distanceM: 180,
    etaMin: 4,
    online: true,
    blurb: '巷口檳榔攤旁，三分鐘隨叫隨到。',
    avatarColor: '#C9A66B',
    map: { x: 0.32, y: 0.38 },
  },
  {
    id: 'h2',
    name: 'Kevin',
    rank: '捲報紙達人',
    rating: 4.7,
    kills: 128,
    distanceM: 320,
    etaMin: 6,
    online: true,
    blurb: '報紙捲得又緊又準，飛的也照打。',
    avatarColor: '#7FB069',
    map: { x: 0.6, y: 0.28 },
  },
  {
    id: 'h3',
    name: '小薇',
    rank: '捲報紙達人',
    rating: 4.8,
    kills: 156,
    distanceM: 450,
    etaMin: 8,
    online: true,
    blurb: '輕手輕腳，善後清潔免加價。',
    avatarColor: '#FB6B4B',
    map: { x: 0.5, y: 0.62 },
  },
  {
    id: 'h4',
    name: '老張',
    rank: '拖鞋見習生',
    rating: 4.5,
    kills: 27,
    distanceM: 600,
    etaMin: 11,
    online: true,
    blurb: '夾腳拖一甩，新手價最划算。',
    avatarColor: '#969DA9',
    map: { x: 0.74, y: 0.55 },
  },
  {
    id: 'h5',
    name: 'Mia',
    rank: '拖鞋見習生',
    rating: 4.6,
    kills: 41,
    distanceM: 720,
    etaMin: 13,
    online: false,
    blurb: '夜貓子，半夜場專屬。',
    avatarColor: '#B58E4F',
    map: { x: 0.22, y: 0.7 },
  },
];

export const RANK_ORDER = HUNTER_RANKS;

/** 目前登入的呼救者（鎮宅金主）— mock */
export const CURRENT_USER = {
  name: '你',
  title: '鎮宅金主',
  address: '夏日公寓 4 樓・客廳',
  rescued: 8,
} as const;
