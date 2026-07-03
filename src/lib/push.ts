import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { isValidLatLng } from '@/lib/geo';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { type LatLng } from '@/store/useAppStore';

/**
 * 推播（Expo Push Notifications）總管。
 *
 * 架構：token 存進 push_tokens 表（RLS 僅本人）→ 事件發生時 App 呼叫
 * Edge Function `notify`（見 supabase/functions/notify）→ Function 用
 * service_role 查收件人 token、打 Expo Push API。token 全程不離開伺服器，
 * 前端拿不到任何別人的 token。
 *
 * 平台限制（SDK 54）：
 * - Android 的 Expo Go 自 SDK 53 起不支援遠端推播 → 靜默跳過，待 dev build。
 * - iOS 的 Expo Go 可以正常收推播。
 * - 需要 EAS projectId（跑過 `npx eas-cli init`）才能取得 token；沒有就跳過。
 */

// 前景收到推播時也要顯示橫幅（預設前景是靜默的，聊天中不影響、退到別頁仍看得到）
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Android 的 Expo Go：SDK 53 起遠端推播已被移除，任何嘗試都會丟錯 → 直接跳過 */
const isExpoGoAndroid =
  Platform.OS === 'android' &&
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * 請求通知權限並取得 Expo push token。
 * 任一環節不可用（模擬器 / Android Expo Go / 使用者拒絕 / 尚未 eas init）
 * 一律回 null，絕不擋 App 主流程。
 */
async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice || isExpoGoAndroid) return null;
  try {
    // Android 13+：必須先建 channel，系統權限彈窗才會出現
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: '任務通知',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return null;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null; // 尚未綁定 EAS 專案（npx eas-cli init）
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch {
    return null;
  }
}

/**
 * 登入後掛在根 layout 的 hook：
 * 1. userId 就緒 → 要權限、取 token、upsert 進 push_tokens（換帳號會重綁）。
 * 2. 監聽「點擊推播」→ 依 payload 的 route 直接導到對應頁面。
 */
export function usePushNotifications(userId: string | null): void {
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !userId) return;
    const client = supabase;
    let active = true;
    getPushToken().then((token) => {
      if (!active || !token) return;
      client
        .from('push_tokens')
        .upsert({ user_id: userId, token, updated_at: new Date().toISOString() })
        .then(() => {});
    });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const route = resp.notification.request.content.data?.route;
      if (typeof route === 'string' && route.startsWith('/')) router.push(route as Href);
    });
    return () => sub.remove();
  }, []);
}

/**
 * 更新自己的「最後已知位置」（獵人進任務池時呼叫）。
 * 用 update 而非 upsert：沒 token 列（未授權通知）就靜默無事，不會造出殘缺列。
 */
export function updatePushLocation(userId: string | null, loc: LatLng | null): void {
  if (!isSupabaseConfigured || !supabase || !userId || !isValidLatLng(loc)) return;
  supabase
    .from('push_tokens')
    .update({ lat: loc.latitude, lng: loc.longitude, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .then(() => {});
}

type NotifyPayload =
  | { type: 'new_order'; order_id: string }
  | { type: 'order_accepted'; order_id: string }
  | { type: 'new_message'; order_id: string; preview: string };

/**
 * fire-and-forget 呼叫 Edge Function `notify`。
 * 推播是加分項：失敗（尚未部署 / 離線）絕不阻塞或干擾主流程，靜默吞掉。
 */
function invokeNotify(payload: NotifyPayload): void {
  if (!isSupabaseConfigured || !supabase) return;
  supabase.functions.invoke('notify', { body: payload }).catch(() => {});
}

/** 情境 A：發單成功後廣播給符合條件的獵人（條件判定在 Edge Function 內） */
export function notifyNewOrder(orderId: string): void {
  invokeNotify({ type: 'new_order', order_id: orderId });
}

/** 情境 B：搶單成功後通知求救者「獵人已出發 + ETA」 */
export function notifyOrderAccepted(orderId: string): void {
  invokeNotify({ type: 'order_accepted', order_id: orderId });
}

/** 情境 C：送出訊息後通知對方（收件人由 Function 依訂單當事人判定） */
export function notifyNewMessage(orderId: string, preview: string): void {
  invokeNotify({ type: 'new_message', order_id: orderId, preview });
}
