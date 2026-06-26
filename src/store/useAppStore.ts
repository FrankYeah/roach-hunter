import { create } from 'zustand';

import type { TargetTier } from '@/constants/brand';
import type { OrderRow } from '@/lib/orders';

/** 使用者身分：求救者（鎮宅金主）/ 獵人 */
export type Role = 'requester' | 'hunter';

/** 訂單狀態：閒置 → 媒合中 → 已接單 → 任務完成 */
export type OrderStatus = 'idle' | 'matching' | 'accepted' | 'completed';

export interface OrderDraft {
  tierId: TargetTier['id'];
  addonIds: string[];
  total: number;
}

export type LatLng = { latitude: number; longitude: number };

/** Supabase session 的最小型別（解耦，不直接依賴 supabase-js 型別）*/
export type AuthSessionLike = { user: { id: string; phone?: string | null } } | null;

interface AppState {
  // ── 身分切換 ───────────────────────────────
  role: Role;
  toggleRole: () => void;

  // ── 求救者：訂單流程 ───────────────────────
  orderStatus: OrderStatus;
  order: OrderDraft | null;
  /** 媒合到的獵人 id */
  matchedHunterId: string | null;
  /** 這筆訂單在 Supabase 的 id（Realtime 訂閱用）*/
  orderId: string | null;
  startMatching: (order: OrderDraft) => void;
  confirmMatched: (hunterId: string) => void;
  completeOrder: () => void;
  resetOrder: () => void;
  setOrderId: (id: string | null) => void;

  // ── 獵人：接單 ─────────────────────────────
  acceptedTaskId: string | null;
  /** 真實模式：搶到的訂單列 */
  acceptedOrder: OrderRow | null;
  acceptTask: (taskId: string) => void;
  setAcceptedOrder: (order: OrderRow | null) => void;
  finishTask: () => void;

  // ── 帳號 / 登入 ────────────────────────────
  isAuthenticated: boolean;
  /** 是否已完成冷啟動的 session 還原檢查 */
  authReady: boolean;
  phone: string | null;
  userId: string | null;
  /** 使用者目前定位（建立訂單寫入 lat/lng 用）*/
  userLocation: LatLng | null;
  login: (phone: string) => void;
  logout: () => void;
  setAuthReady: (v: boolean) => void;
  applySession: (session: AuthSessionLike) => void;
  setUserLocation: (loc: LatLng | null) => void;

  // ── 獵人實名認證 ───────────────────────────
  verification: { idFront: boolean; idBack: boolean; police: boolean };
  setVerificationDoc: (key: 'idFront' | 'idBack' | 'police', value: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  role: 'requester',
  toggleRole: () => set((s) => ({ role: s.role === 'requester' ? 'hunter' : 'requester' })),

  orderStatus: 'idle',
  order: null,
  matchedHunterId: null,
  orderId: null,
  startMatching: (order) => set({ order, orderStatus: 'matching', matchedHunterId: null }),
  confirmMatched: (hunterId) => set({ orderStatus: 'accepted', matchedHunterId: hunterId }),
  completeOrder: () => set({ orderStatus: 'completed' }),
  resetOrder: () => set({ orderStatus: 'idle', order: null, matchedHunterId: null, orderId: null }),
  setOrderId: (id) => set({ orderId: id }),

  acceptedTaskId: null,
  acceptedOrder: null,
  acceptTask: (taskId) => set({ acceptedTaskId: taskId }),
  setAcceptedOrder: (order) => set({ acceptedOrder: order }),
  finishTask: () => set({ acceptedTaskId: null, acceptedOrder: null }),

  isAuthenticated: false,
  authReady: false,
  phone: null,
  userId: null,
  userLocation: null,
  login: (phone) => set({ isAuthenticated: true, phone }),
  logout: () => set({ isAuthenticated: false, phone: null, userId: null }),
  setAuthReady: (v) => set({ authReady: v }),
  applySession: (session) =>
    set({
      isAuthenticated: !!session,
      userId: session?.user?.id ?? null,
      phone: session?.user?.phone ? `+${session.user.phone}` : null,
    }),
  setUserLocation: (loc) => set({ userLocation: loc }),

  verification: { idFront: false, idBack: false, police: false },
  setVerificationDoc: (key, value) =>
    set((s) => ({ verification: { ...s.verification, [key]: value } })),
}));
