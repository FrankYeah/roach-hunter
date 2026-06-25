import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Text, View } from 'react-native';

import { RANK_STYLE, type HunterRank } from '@/constants/brand';

interface RankBadgeProps {
  rank: HunterRank;
  /** 小尺寸用於列表，大尺寸用於個人頁 */
  size?: 'sm' | 'md';
}

export function RankBadge({ rank, size = 'sm' }: RankBadgeProps) {
  const style = RANK_STYLE[rank];
  const iconSize = size === 'sm' ? 12 : 16;
  const iconColor = rank === '白金殺手' ? '#969DA9' : rank === '捲報紙達人' ? '#2A2521' : '#9A763C';

  return (
    <View
      className={`flex-row items-center self-start rounded-full ${style.badge} ${
        size === 'sm' ? 'px-2 py-0.5' : 'px-3 py-1'
      }`}
    >
      <MaterialCommunityIcons name={style.icon as any} size={iconSize} color={iconColor} />
      <Text className={`${style.text} ${size === 'sm' ? 'ml-1 text-xs' : 'ml-1.5 text-sm'} font-semibold`}>
        {rank}
      </Text>
    </View>
  );
}
