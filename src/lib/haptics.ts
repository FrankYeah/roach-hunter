import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * 觸覺回饋小工具。Web 上 expo-haptics 不適用，一律略過。
 */

/** 重按回饋：用於「乾，出現了！」呼救大按鈕 */
export function tapHaptic() {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

/** 成功回饋：用於「媒合成功」「接單成功」的瞬間 */
export function successHaptic() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** 輕觸回饋：用於切換身分等次要操作 */
export function selectHaptic() {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync();
}
