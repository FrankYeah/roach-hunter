import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Alert, Pressable } from 'react-native';

import { blockUser, reportUser } from '@/lib/safety';

/**
 * 「⋯」安全選單：檢舉 / 封鎖對方。放在對方資訊卡右上角，求救端與獵人端共用。
 * 封鎖只影響「日後媒合」（雙方不再互相看到單），不會中止當前這張進行中的單。
 */
export function ReportBlockButton({
  selfId,
  targetId,
  targetName,
  orderId,
}: {
  selfId: string | null;
  targetId: string | null;
  targetName: string;
  orderId: string | null;
}) {
  const [busy, setBusy] = useState(false);

  const doReport = () => {
    Alert.alert(
      '檢舉' + targetName + '？',
      '我們會將這次互動送交客服審核，你的身分不會透露給對方。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '確認檢舉',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const { error } = await reportUser(selfId, targetId, orderId, 'reported_from_app');
            setBusy(false);
            Alert.alert(
              error ? '檢舉失敗' : '已收到檢舉',
              error ?? '客服會盡快審核，感謝你的回報。',
            );
          },
        },
      ],
    );
  };

  const doBlock = () => {
    Alert.alert(
      '封鎖' + targetName + '？',
      '封鎖後你們日後不會再被互相媒合。目前這張進行中的單不受影響。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '確認封鎖',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const { error } = await blockUser(selfId, targetId);
            setBusy(false);
            Alert.alert(
              error ? '封鎖失敗' : '已封鎖',
              error ?? `你和${targetName}日後不會再被媒合。`,
            );
          },
        },
      ],
    );
  };

  const openMenu = () => {
    if (busy || !targetId) return;
    Alert.alert('安全選項', `對${targetName}的操作`, [
      { text: '檢舉', style: 'destructive', onPress: doReport },
      { text: '封鎖', style: 'destructive', onPress: doBlock },
      { text: '取消', style: 'cancel' },
    ]);
  };

  return (
    <Pressable
      onPress={openMenu}
      disabled={busy || !targetId}
      accessibilityRole="button"
      accessibilityLabel={`檢舉或封鎖 ${targetName}`}
      hitSlop={10}
      className="h-8 w-8 items-center justify-center rounded-full"
    >
      <Ionicons name="ellipsis-horizontal" size={18} color="#9A8F80" />
    </Pressable>
  );
}
