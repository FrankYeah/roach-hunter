import { type ViewStyle } from 'react-native';

/**
 * 共用陰影樣式。
 * 依官方 expo/building-native-ui 指引使用 `boxShadow`（RN 0.76+ 新架構），
 * 取代已棄用的 shadowColor / shadowOpacity / elevation 寫法。
 */

/** 柔和卡片陰影（暖黑、低透明）。 */
export const shadowSoft: ViewStyle = {
  boxShadow: '0px 6px 12px rgba(42, 37, 33, 0.10)',
};

/** 呼救主按鈕的強調陰影（暖橘紅光暈）。 */
export const shadowSos: ViewStyle = {
  boxShadow: '0px 10px 20px rgba(226, 85, 58, 0.40)',
};
