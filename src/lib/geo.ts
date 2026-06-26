import { type LatLng } from '@/store/useAppStore';

/** 兩點間的直線距離（公尺，Haversine）*/
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

/** 由距離粗估抵達分鐘（約市區機車 250 m/分）*/
export function etaMinFromMeters(m: number): number {
  return Math.max(2, Math.round(m / 250));
}
