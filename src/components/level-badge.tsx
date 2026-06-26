import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Text, View } from 'react-native';

import { type HunterLevel } from '@/constants/brand';

/** 各等級徽章的 icon 色（隨等級往金屬銀漸進）*/
const ICON_COLOR: Record<HunterLevel['id'], string> = {
  rookie: '#9A763C',
  skilled: '#2A2521',
  veteran: '#969DA9',
  master: '#FFFFFF',
};

export function LevelBadge({ level, size = 'sm' }: { level: HunterLevel; size?: 'sm' | 'md' }) {
  const iconSize = size === 'sm' ? 12 : 16;
  return (
    <View
      className={`flex-row items-center self-start rounded-full ${level.badge} ${
        size === 'sm' ? 'px-2 py-0.5' : 'px-3 py-1'
      }`}
    >
      <MaterialCommunityIcons name={level.icon as never} size={iconSize} color={ICON_COLOR[level.id]} />
      <Text className={`${level.text} ${size === 'sm' ? 'ml-1 text-xs' : 'ml-1.5 text-sm'} font-semibold`}>
        {level.name}
      </Text>
    </View>
  );
}
