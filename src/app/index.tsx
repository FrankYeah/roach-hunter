import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MosaicTarget } from '@/components/mosaic-target';
import { BRAND } from '@/constants/brand';
import { CURRENT_USER, NEARBY_HUNTERS, type Hunter } from '@/data/hunters';

const cardShadow = {
  shadowColor: '#2A2521',
  shadowOpacity: 0.1,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
};

const sosShadow = {
  shadowColor: '#E2553A',
  shadowOpacity: 0.45,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 10 },
  elevation: 10,
};

/** 地圖上的「閒置獵人」標記，用腳丫子圖示代表 */
function FootMarker({ hunter }: { hunter: Hunter }) {
  return (
    <View
      className="absolute items-center"
      style={{
        left: `${hunter.map.x * 100}%`,
        top: `${hunter.map.y * 100}%`,
        transform: [{ translateX: -24 }, { translateY: -24 }],
        opacity: hunter.online ? 1 : 0.45,
      }}
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-full border-[3px] border-white"
        style={{ backgroundColor: hunter.avatarColor, ...cardShadow }}
      >
        <FontAwesome5 name="shoe-prints" size={18} color="#FFFFFF" />
      </View>
      {hunter.online && (
        <View className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-leaf" />
      )}
      <View className="mt-1 rounded-full bg-white px-2 py-0.5" style={cardShadow}>
        <Text className="text-[10px] font-extrabold text-ink">{hunter.etaMin} 分</Text>
      </View>
    </View>
  );
}

/** 假地圖的裝飾街區色塊 */
function MapDecor() {
  return (
    <View className="absolute inset-0">
      {/* 街道 */}
      <View className="absolute left-0 right-0 top-1/3 h-3 bg-white/70" />
      <View className="absolute left-0 right-0 top-2/3 h-3 bg-white/70" />
      <View className="absolute bottom-0 left-1/3 top-0 w-3 bg-white/70" />
      <View className="absolute bottom-0 right-1/4 top-0 w-3 bg-white/70" />
      {/* 街區 / 公園色塊 */}
      <View className="absolute left-5 top-6 h-16 w-20 rounded-2xl bg-wood-100" />
      <View className="absolute right-6 top-10 h-20 w-16 rounded-2xl bg-wood-200" />
      <View className="absolute bottom-10 left-8 h-16 w-16 rounded-2xl bg-silver-light" />
      <View className="absolute bottom-8 right-10 h-20 w-24 rounded-2xl bg-wood-100" />
      <View className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-7 -translate-y-7 rounded-full bg-leaf/20" />
    </View>
  );
}

export default function HomeScreen() {
  const onlineHunters = NEARBY_HUNTERS.filter((h) => h.online);
  const nearestEta = Math.min(...onlineHunters.map((h) => h.etaMin));

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      {/* 頂部品牌列 */}
      <View className="flex-row items-center justify-between px-5 pb-3 pt-1">
        <View>
          <Text className="text-2xl font-black text-ink">{BRAND.appName}</Text>
          <Text className="mt-0.5 text-xs text-mute">{BRAND.tagline}</Text>
        </View>
        <View className="flex-row items-center rounded-full bg-cream px-3 py-1.5" style={cardShadow}>
          <View className="h-7 w-7 items-center justify-center rounded-full bg-wood-300">
            <Ionicons name="home" size={14} color="#FFFFFF" />
          </View>
          <Text className="ml-2 text-xs font-bold text-ink">{CURRENT_USER.title}</Text>
        </View>
      </View>

      {/* 地圖 */}
      <View className="mx-4 flex-1 overflow-hidden rounded-[28px] border border-wood-100 bg-cream" style={cardShadow}>
        <MapDecor />

        {/* 在線數量浮卡 */}
        <View className="absolute left-4 top-4 flex-row items-center rounded-full bg-white px-3 py-2" style={cardShadow}>
          <View className="mr-2 h-2.5 w-2.5 rounded-full bg-leaf" />
          <Text className="text-sm font-bold text-ink">
            附近有 {onlineHunters.length} 位閒置獵人
          </Text>
        </View>

        {/* 獵人腳丫子標記 */}
        {NEARBY_HUNTERS.map((h) => (
          <FootMarker key={h.id} hunter={h} />
        ))}

        {/* 你家（出現「那個」的位置）*/}
        <View
          className="absolute items-center"
          style={{ left: '50%', top: '48%', transform: [{ translateX: -36 }, { translateY: -40 }] }}
        >
          <View className="items-center justify-center rounded-2xl bg-white p-2" style={cardShadow}>
            <MosaicTarget size={40} />
          </View>
          <View className="mt-1 flex-row items-center rounded-full bg-ink px-2.5 py-1">
            <Ionicons name="warning" size={12} color="#FB6B4B" />
            <Text className="ml-1 text-[11px] font-bold text-white">你家・有訪客</Text>
          </View>
        </View>
      </View>

      {/* 底部呼救區 */}
      <View className="px-5 pb-3 pt-4">
        <View className="mb-3 flex-row items-center justify-center">
          <FontAwesome5 name="shoe-prints" size={12} color="#9A8F80" />
          <Text className="ml-2 text-xs text-mute">
            腳丫子 = 閒置獵人　·　最快的獵人 <Text className="font-bold text-sos">{nearestEta} 分鐘</Text> 到
          </Text>
        </View>

        <Pressable
          onPress={() => router.push('/order')}
          className="active:scale-[0.98]"
          style={({ pressed }) => [sosShadow, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <View className="flex-row items-center justify-center rounded-[28px] bg-sos py-5">
            <MosaicTarget size={30} color="#FFFFFF" vibrate />
            <Text className="ml-3 text-2xl font-black text-white">{BRAND.sosLabel}</Text>
          </View>
        </Pressable>
        <Text className="mt-2 text-center text-[11px] text-mute">一鍵呼叫・按下後選擇狀況與指導價</Text>
      </View>
    </SafeAreaView>
  );
}
