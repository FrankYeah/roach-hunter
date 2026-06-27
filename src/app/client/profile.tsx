import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { shadowSoft, shadowSos } from '@/constants/shadows';
import { signOut } from '@/lib/auth';
import { selectHaptic, successHaptic } from '@/lib/haptics';
import { fetchProfile, updateProfile, type Gender, type Profile } from '@/lib/profiles';
import { useAppStore } from '@/store/useAppStore';

const GENDERS: { id: Gender; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'male', label: '男性', icon: 'male' },
  { id: 'female', label: '女性', icon: 'female' },
  { id: 'unspecified', label: '不公開', icon: 'remove-circle-outline' },
];

export default function ClientProfileScreen() {
  const userId = useAppStore((s) => s.userId);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [gender, setGender] = useState<Gender>('unspecified');

  // 回填現有的個人資料（名稱 / 地址基底 / 性別）
  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchProfile(userId).then((p) => {
      if (!active || !p) return;
      setProfile(p);
      setName(p.display_name);
      setLocation(p.default_location_name ?? '');
      setGender(p.gender);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const chooseGender = (g: Gender) => {
    selectHaptic();
    setGender(g);
    updateProfile(userId, { gender: g }); // 即時寫回
  };

  const save = () => {
    successHaptic();
    const display_name = name.trim() || '鎮宅金主';
    setName(display_name);
    updateProfile(userId, {
      display_name,
      default_location_name: location.trim() || null,
    });
    Alert.alert('已儲存', '你的個人資料已更新');
  };

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      {/* 標題列 */}
      <View className="flex-row items-center px-4 pb-2 pt-1">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          className="h-10 w-10 items-center justify-center rounded-full bg-cream"
        >
          <Ionicons name="chevron-back" size={22} color="#2A2521" />
        </Pressable>
        <Text className="ml-3 text-xl font-black text-ink">個人設定</Text>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {/* 個人卡 */}
        <View className="mt-2 flex-row items-center rounded-3xl bg-white p-4" style={shadowSoft}>
          <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-wood-300">
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={{ width: 64, height: 64 }} />
            ) : (
              <Ionicons name="home" size={26} color="#FFFFFF" />
            )}
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-lg font-black text-ink">{profile?.display_name ?? '鎮宅金主'}</Text>
            <View className="mt-1 flex-row items-center">
              <Ionicons name="star" size={13} color="#F5A623" />
              <Text className="ml-1 text-xs font-bold text-ink">{(profile?.rating ?? 5).toFixed(1)}</Text>
              <Text className="ml-2 text-xs text-mute">求救者・鎮宅金主</Text>
            </View>
          </View>
        </View>

        {/* 顯示名稱 */}
        <View className="mb-2 mt-6 flex-row items-center">
          <MaterialCommunityIcons name="account-outline" size={18} color="#2A2521" />
          <Text className="ml-2 text-base font-black text-ink">顯示名稱</Text>
        </View>
        <View className="rounded-2xl border-2 border-wood-100 bg-white px-4 py-3" style={shadowSoft}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="鎮宅金主"
            placeholderTextColor="#C4BCB0"
            accessibilityLabel="顯示名稱"
            maxLength={20}
            className="text-base font-bold text-ink"
          />
        </View>

        {/* 地址基底 */}
        <View className="mb-2 mt-6 flex-row items-center">
          <MaterialCommunityIcons name="map-marker-outline" size={18} color="#2A2521" />
          <Text className="ml-2 text-base font-black text-ink">地址基底</Text>
        </View>
        <View className="rounded-2xl border-2 border-wood-100 bg-white px-4 py-3" style={shadowSoft}>
          <Text className="mb-1 text-[11px] text-mute">
            模糊地址（如「夏日公寓」/「安樂區安一路」），發單時自動帶入當底稿
          </Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="例如：基隆市安樂區安一路 夏日公寓"
            placeholderTextColor="#C4BCB0"
            accessibilityLabel="地址基底，模糊地址"
            className="text-base font-bold text-ink"
          />
        </View>
        <View className="mt-2 flex-row items-center rounded-xl bg-leaf/10 px-3 py-2">
          <Ionicons name="lock-closed" size={13} color="#7FB069" />
          <Text className="ml-1.5 flex-1 text-[11px] text-leaf">
            這只是模糊基底；發單時的精確門牌會獨立保護，媒合成功前任何獵人都看不到
          </Text>
        </View>

        {/* 性別 */}
        <View className="mb-2 mt-6 flex-row items-center">
          <MaterialCommunityIcons name="gender-male-female" size={18} color="#2A2521" />
          <Text className="ml-2 text-base font-black text-ink">性別</Text>
        </View>
        <View className="flex-row">
          {GENDERS.map((g) => {
            const on = gender === g.id;
            return (
              <Pressable
                key={g.id}
                onPress={() => chooseGender(g.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`性別 ${g.label}`}
                className="mr-2"
              >
                <View
                  className={`flex-row items-center rounded-full border px-3.5 py-2 ${
                    on ? 'border-sos bg-sos/10' : 'border-wood-200 bg-white'
                  }`}
                >
                  <Ionicons name={g.icon} size={14} color={on ? '#FB6B4B' : '#9A8F80'} />
                  <Text className={`ml-1.5 text-xs font-bold ${on ? 'text-sos' : 'text-ink'}`}>{g.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* 儲存 */}
        <Pressable
          onPress={save}
          accessibilityRole="button"
          accessibilityLabel="儲存個人資料"
          className="mt-8"
          style={({ pressed }) => [shadowSos, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <View className="flex-row items-center justify-center rounded-[24px] bg-sos py-4">
            <FontAwesome5 name="save" size={15} color="#FFFFFF" />
            <Text className="ml-2 text-lg font-black text-white">儲存個人資料</Text>
          </View>
        </Pressable>

        {/* 登出 */}
        <Pressable
          onPress={() => signOut()}
          accessibilityRole="button"
          accessibilityLabel="登出"
          className="mt-3"
          style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <View className="flex-row items-center justify-center rounded-2xl border border-wood-200 bg-white py-3.5" style={shadowSoft}>
            <Ionicons name="log-out-outline" size={18} color="#E2553A" />
            <Text className="ml-2 text-sm font-bold text-sos">登出</Text>
          </View>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
