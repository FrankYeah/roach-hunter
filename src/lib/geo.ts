import { type LatLng } from '@/store/useAppStore';

/** 寬鬆的座標型別：欄位可能是 null/undefined（例如尚未取得定位、或 DB 欄位為空）*/
type MaybeLatLng =
  | { latitude: number | null | undefined; longitude: number | null | undefined }
  | null
  | undefined;

/**
 * 經緯度是否合理。排除：null/undefined、NaN、超出範圍、
 * 以及 (0,0) 這個「定位尚未就緒」幾乎必然是的預設哨兵值。
 */
export function isValidLatLng(p: MaybeLatLng): p is LatLng {
  if (!p) return false;
  const lat = p.latitude;
  const lng = p.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // 真實救援不會發生在幾內亞灣的 (0,0)，視為尚未定位
  if (Math.abs(lat) < 1e-4 && Math.abs(lng) < 1e-4) return false;
  return true;
}

/** 兩點間的直線距離（公尺，Haversine）。兩端座標都須先確認有效。*/
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * 防呆版距離：任一端座標無效（缺失 / (0,0) / 超範圍）即回傳 null，
 * 由呼叫端顯示「距離計算中…」，絕不算出極端數值。
 */
export function safeDistanceMeters(a: MaybeLatLng, b: MaybeLatLng): number | null {
  if (!isValidLatLng(a) || !isValidLatLng(b)) return null;
  return distanceMeters(a, b);
}

/** 由距離粗估抵達分鐘（約市區機車 250 m/分），夾在 2–120 分鐘的合理區間 */
export function etaMinFromMeters(m: number): number {
  if (!Number.isFinite(m) || m < 0) return 10;
  return Math.min(120, Math.max(2, Math.round(m / 250)));
}
