import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlipFlopLogo } from '@/components/flip-flop-logo';
import { MosaicTarget } from '@/components/mosaic-target';
import { BRAND } from '@/constants/brand';
import { shadowSoft, shadowSos } from '@/constants/shadows';
import { NEARBY_HUNTERS, type Hunter } from '@/data/hunters';
import { selectHaptic, tapHaptic } from '@/lib/haptics';
import { fetchProfile } from '@/lib/profiles';
import { useAppStore } from '@/store/useAppStore';

/** 預設座標（定位失敗/未授權時退回台北市中心） */
const DEFAULT_CENTER = { latitude: 25.033, longitude: 121.5654 };

type LatLng = { latitude: number; longitude: number };
type PlacedHunter = Hunter & { coordinate: LatLng };

/** 把獵人隨機散佈在中心點 1~2 公里範圍內 */
function scatter(center: LatLng): PlacedHunter[] {
  return NEARBY_HUNTERS.map((h) => {
    const angle = Math.random() * 2 * Math.PI;
    const dist = 1000 + Math.random() * 1000; // 公尺
    const dLat = (dist * Math.cos(angle)) / 111320;
    const dLng = (dist * Math.sin(angle)) / (111320 * Math.cos((center.latitude * Math.PI) / 180));
    return { ...h, coordinate: { latitude: center.latitude + dLat, longitude: center.longitude + dLng } };
  });
}

/** Google Maps（Android）極簡奶油白＋淺木質樣式；iOS 用 showsPointsOfInterest 等 props */
const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#FBF6EE' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9A8F80' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FBF6EE' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#F2E4CE' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#F3E7D3' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D9EAF2' }] },
];

/** 地圖上的獵人腳丫子標記 */
function HunterMarker({ hunter, tracks }: { hunter: PlacedHunter; tracks: boolean }) {
  return (
    <Marker coordinate={hunter.coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}>
      <View style={{ opacity: hunter.online ? 1 : 0.45 }}>
        <View
          className="h-11 w-11 items-center justify-center rounded-full border-2 border-white"
          style={{ backgroundColor: hunter.avatarColor, ...shadowSoft }}
        >
          <FontAwesome5 name="shoe-prints" size={16} color="#FFFFFF" />
        </View>
        {hunter.online && (
          <View className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-leaf" />
        )}
      </View>
    </Marker>
  );
}

export default function HomeScreen() {
  const onlineHunters = NEARBY_HUNTERS.filter((h) => h.online);
  const nearestEta = Math.min(...onlineHunters.map((h) => h.etaMin));
  const toggleRole = useAppStore((s) => s.toggleRole);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setUserLocation = useAppStore((s) => s.setUserLocation);
  const userId = useAppStore((s) => s.userId);
  const displayName = useAppStore((s) => s.displayName);
  const setDisplayName = useAppStore((s) => s.setDisplayName);

  // 每次回到首頁都同步一次顯示名稱 → 個人設定改完返回立即反映（搭配 store 即時更新）
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      fetchProfile(userId).then((p) => {
        if (active && p) setDisplayName(p.display_name);
      });
      return () => {
        active = false;
      };
    }, [userId, setDisplayName]),
  );

  const [center, setCenter] = useState<LatLng | null>(null);
  const [markers, setMarkers] = useState<PlacedHunter[]>([]);
  const [tracks, setTracks] = useState(true);

  // 進入首頁時請求定位權限，並把地圖中心移到使用者位置
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      let c = DEFAULT_CENTER;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        }
      } catch {
        // 忽略：退回預設座標
      }
      if (cancelled) return;
      setCenter(c);
      setMarkers(scatter(c));
      setUserLocation(c); // 供建立訂單寫入 lat/lng
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, setUserLocation]);

  // 自訂 Marker：先 track 讓圖示渲染出來，1.5s 後凍結以省效能
  useEffect(() => {
    if (!center) return;
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 1500);
    return () => clearTimeout(t);
  }, [center]);

  const region: Region | null = center
    ? { ...center, latitudeDelta: 0.025, longitudeDelta: 0.025 }
    : null;

  const callSos = () => {
    tapHaptic();
    router.push('/order');
  };

  const switchToHunter = () => {
    selectHaptic();
    toggleRole();
    router.replace('/hunter');
  };

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      {/* 頂部品牌列 */}
      <View className="flex-row items-center justify-between px-5 pb-3 pt-1">
        <View className="flex-row items-center">
          <View className="mr-2.5 h-10 w-10 items-center justify-center rounded-2xl bg-cream" style={shadowSoft}>
            <FlipFlopLogo size={24} color="#9A763C" />
          </View>
          <Text className="text-sm font-bold text-mute">{BRAND.tagline}</Text>
        </View>
        <View className="flex-row items-center">
          {/* 個人設定（名稱 / 地址基底 / 性別）*/}
          <Pressable
            onPress={() => router.push('/client/profile')}
            accessibilityRole="button"
            accessibilityLabel="個人設定"
            className="mr-2 h-9 w-9 items-center justify-center rounded-full bg-cream"
            style={shadowSoft}
          >
            <Ionicons name="person-circle-outline" size={20} color="#9A763C" />
          </Pressable>
          {/* 點頭像即可切換為「獵人」身分 */}
          <Pressable
            onPress={switchToHunter}
            accessibilityRole="button"
            accessibilityLabel="切換為獵人身分"
            className="flex-row items-center rounded-full bg-cream px-3 py-1.5"
            style={shadowSoft}
          >
            <View className="h-7 w-7 items-center justify-center rounded-full bg-wood-300">
              <Ionicons name="home" size={14} color="#FFFFFF" />
            </View>
            <Text className="ml-2 text-xs font-bold text-ink">{displayName ?? '求救者'}</Text>
            <MaterialCommunityIcons name="swap-horizontal" size={14} color="#9A8F80" style={{ marginLeft: 6 }} />
          </Pressable>
        </View>
      </View>

      {/* 地圖 */}
      <View className="mx-4 flex-1 overflow-hidden rounded-[28px] border border-wood-100 bg-cream" style={shadowSoft}>
        {region ? (
          <MapView
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_DEFAULT}
            region={region}
            customMapStyle={MAP_STYLE}
            showsPointsOfInterest={false}
            showsBuildings={false}
            showsTraffic={false}
            showsIndoors={false}
            showsCompass={false}
            toolbarEnabled={false}
            showsMyLocationButton={false}
            pitchEnabled={false}
            rotateEnabled={false}
            loadingEnabled
            loadingBackgroundColor="#FBF6EE"
          >
            {/* 你家（出現「那個」的位置）*/}
            {center && (
              <Marker coordinate={center} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={tracks}>
                <View className="items-center">
                  <View className="items-center justify-center rounded-2xl bg-white p-1.5" style={shadowSoft}>
                    <MosaicTarget size={30} />
                  </View>
                  <View className="mt-1 flex-row items-center rounded-full bg-ink px-2 py-0.5">
                    <Ionicons name="warning" size={10} color="#FB6B4B" />
                    <Text className="ml-1 text-[10px] font-bold text-white">你家・有訪客</Text>
                  </View>
                </View>
              </Marker>
            )}

            {markers.map((h) => (
              <HunterMarker key={h.id} hunter={h} tracks={tracks} />
            ))}
          </MapView>
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#FB6B4B" />
            <Text className="mt-3 text-xs text-mute">定位中…正在抓取你的位置</Text>
          </View>
        )}

        {/* 在線數量浮卡 */}
        <View className="absolute left-4 top-4 flex-row items-center rounded-full bg-white px-3 py-2" style={shadowSoft}>
          <View className="mr-2 h-2.5 w-2.5 rounded-full bg-leaf" />
          <Text className="text-sm font-bold text-ink">附近有 {onlineHunters.length} 位閒置獵人</Text>
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
          onPress={callSos}
          accessibilityRole="button"
          accessibilityLabel={`${BRAND.sosLabel} 呼叫附近獵人`}
          accessibilityHint="開啟呼救表單，選擇現場狀況與指導價"
          className="active:scale-[0.98]"
          style={({ pressed }) => [shadowSos, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
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
