import { create } from 'zustand';

import type { TargetTier } from '@/constants/brand';

/** 使用者身分：求救者（鎮宅金主）/ 獵人 */
export type Role = 'requester' | 'hunter';

/** 訂單狀態：閒置 → 媒合中 → 已接單 → 任務完成 */
export type OrderStatus = 'idle' | 'matching' | 'accepted' | 'completed';

export interface OrderDraft {
  tierId: TargetTier['id'];
  addonIds: string[];
  total: number;
}

interface AppState {
  // ── 身分切換 ───────────────────────────────
  role: Role;
  toggleRole: () => void;

  // ── 求救者：訂單流程 ───────────────────────
  orderStatus: OrderStatus;
  order: OrderDraft | null;
  /** 媒合到的獵人 id */
  matchedHunterId: string | null;
  startMatching: (order: OrderDraft) => void;
  confirmMatched: (hunterId: string) => void;
  completeOrder: () => void;
  resetOrder: () => void;

  // ── 獵人：接單 ─────────────────────────────
  acceptedTaskId: string | null;
  acceptTask: (taskId: string) => void;
  finishTask: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  role: 'requester',
  toggleRole: () => set((s) => ({ role: s.role === 'requester' ? 'hunter' : 'requester' })),

  orderStatus: 'idle',
  order: null,
  matchedHunterId: null,
  startMatching: (order) => set({ order, orderStatus: 'matching', matchedHunterId: null }),
  confirmMatched: (hunterId) => set({ orderStatus: 'accepted', matchedHunterId: hunterId }),
  completeOrder: () => set({ orderStatus: 'completed' }),
  resetOrder: () => set({ orderStatus: 'idle', order: null, matchedHunterId: null }),

  acceptedTaskId: null,
  acceptTask: (taskId) => set({ acceptedTaskId: taskId }),
  finishTask: () => set({ acceptedTaskId: null }),
}));
