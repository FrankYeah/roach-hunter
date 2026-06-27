import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LevelBadge } from '@/components/level-badge';
import { levelFromCompleted } from '@/constants/brand';
import { shadowSoft } from '@/constants/shadows';
import { signOut } from '@/lib/auth';
import { selectHaptic, successHaptic } from '@/lib/haptics';
import { fetchProfile, updateProfile, type Gender, type Profile } from '@/lib/profiles';
import { useAppStore } from '@/store/useAppStore';

const GENDERS: { id: Gender; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'male', label: '男性', icon: 'male' },
  { id: 'female', label: '女性', icon: 'female' },
  { id: 'unspecified', label: '不公開', icon: 'remove-circle-outline' },
];

type DocKey = 'idFront' | 'idBack' | 'police';

function UploadRow({
  icon,
  label,
  hint,
  done,
  onUpload,
  onRemove,
}: {
  icon: string;
  label: string;
  hint: string;
  done: boolean;
  onUpload: () => void;
  onRemove: () => void;
}) {
  return (
    <View
      className={`mb-3 flex-row items-center rounded-3xl border-2 px-4 py-3.5 ${
        done ? 'border-leaf bg-leaf/10' : 'border-dashed border-wood-300 bg-white'
      }`}
      style={done ? undefined : shadowSoft}
    >
      <View className={`h-12 w-12 items-center justify-center rounded-2xl ${done ? 'bg-leaf' : 'bg-cream'}`}>
        {done ? (
          <Ionicons name="checkmark" size={24} color="#FFFFFF" />
        ) : (
          <MaterialCommunityIcons name={icon as never} size={22} color="#9A763C" />
        )}
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-sm font-bold text-ink">{label}</Text>
        <Text className="text-xs text-mute">{done ? '已上傳・審核中' : hint}</Text>
      </View>
      {done ? (
        <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={`移除${label}`} hitSlop={8}>
          <Text className="text-xs font-semibold text-sos">移除</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onUpload}
          accessibilityRole="button"
          accessibilityLabel={`上傳${label}`}
          style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.96 : 1 }] }]}
        >
          <View className="flex-row items-center rounded-full bg-sos px-4 py-2">
            <Ionicons name="cloud-upload-outline" size={15} color="#FFFFFF" />
            <Text className="ml-1 text-xs font-black text-white">上傳</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

export default function HunterProfileScreen() {
  const verification = useAppStore((s) => s.verification);
  const setVerificationDoc = useAppStore((s) => s.setVerificationDoc);
  const userId = useAppStore((s) => s.userId);

  const verified = verification.idFront && verification.idBack;

  // 讀取自己的 profile：回填等級、性別、接單半徑、與「跨裝置保留」的認證狀態
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gender, setGender] = useState<Gender>('unspecified');
  const [radius, setRadius] = useState(2);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchProfile(userId).then((p) => {
      if (!active || !p) return;
      setProfile(p);
      setGender(p.gender);
      setRadius(p.search_radius_km);
      if (p.id_verified) {
        setVerificationDoc('idFront', true);
        setVerificationDoc('idBack', true);
      }
      if (p.police_verified) setVerificationDoc('police', true);
    });
    return () => {
      active = false;
    };
  }, [userId, setVerificationDoc]);

  const level = levelFromCompleted(profile?.completed_tasks ?? 0);
  const isMaster = level.id === 'master'; // 拖鞋仙人才解鎖自訂接單範圍

  const chooseGender = (g: Gender) => {
    selectHaptic();
    setGender(g);
    updateProfile(userId, { gender: g });
  };

  const chooseRadius = (km: number) => {
    if (!isMaster) return;
    selectHaptic();
    setRadius(km);
    updateProfile(userId, { search_radius_km: km });
  };

  // 白金徽章彈入動畫
  const reveal = useRef(new Animated.Value(0)).current;
  const wasVerified = useRef(false);
  useEffect(() => {
    Animated.spring(reveal, {
      toValue: verified ? 1 : 0,
      friction: 6,
      tension: 70,
      useNativeDriver: true,
    }).start();
    if (verified && !wasVerified.current) successHaptic();
    wasVerified.current = verified;
  }, [verified, reveal]);

  // 改變某份文件狀態，並把「整體認證結果」同步寫回 profile
  const setDoc = (key: DocKey, value: boolean) => {
    setVerificationDoc(key, value);
    const next = { ...verification, [key]: value };
    updateProfile(userId, {
      id_verified: next.idFront && next.idBack,
      police_verified: next.police,
    });
  };

  const upload = (key: DocKey) => {
    selectHaptic();
    setDoc(key, true);
  };
  const remove = (key: DocKey) => setDoc(key, false);

  const badgeScale = reveal.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });

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
        {/* 獵人個人卡 */}
        <View className="mt-2 flex-row items-center rounded-3xl bg-white p-4" style={shadowSoft}>
          <View className="h-16 w-16 items-center justify-center rounded-full bg-wood-300">
            <FontAwesome5 name="shoe-prints" size={22} color="#FFFFFF" />
          </View>
          <View className="ml-4 flex-1">
            <View className="flex-row items-center">
              <Text className="text-lg font-black text-ink">{profile?.display_name ?? '見習獵人'}</Text>
              {verified && (
                <MaterialCommunityIcons name="shield-check" size={16} color="#969DA9" style={{ marginLeft: 6 }} />
              )}
            </View>
            <View className="mt-1 flex-row items-center">
              <LevelBadge level={level} />
              <Text className="ml-2 text-xs text-mute">已出動 {profile?.completed_tasks ?? 0} 次</Text>
            </View>
          </View>
        </View>

        {/* 虛擬錢包 / 收入 */}
        <View className="mt-4 flex-row items-center rounded-3xl bg-ink p-4" style={shadowSoft}>
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
            <MaterialCommunityIcons name="wallet-outline" size={24} color="#FFFFFF" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-xs text-silver">錢包餘額</Text>
            <Text className="text-2xl font-black text-white">${profile?.wallet_balance ?? 0}</Text>
          </View>
          <Text className="text-[11px] text-silver">含撲空車馬費</Text>
        </View>

        {/* 性別 */}
        <View className="mb-2 mt-6 flex-row items-center">
          <MaterialCommunityIcons name="account-outline" size={18} color="#2A2521" />
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

        {/* 接單範圍（拖鞋仙人專屬特權）*/}
        <View className="mb-2 mt-6 flex-row items-center">
          <MaterialCommunityIcons name="map-marker-radius-outline" size={18} color="#2A2521" />
          <Text className="ml-2 text-base font-black text-ink">接單範圍</Text>
          {!isMaster && (
            <View className="ml-2 flex-row items-center rounded-full bg-silver-light px-2 py-0.5">
              <MaterialCommunityIcons name="lock" size={10} color="#969DA9" />
              <Text className="ml-1 text-[10px] font-bold text-silver-dark">拖鞋仙人解鎖</Text>
            </View>
          )}
        </View>

        {isMaster ? (
          <>
            <View className="flex-row">
              {[1, 2, 3, 4, 5].map((km) => {
                const on = radius === km;
                return (
                  <Pressable
                    key={km}
                    onPress={() => chooseRadius(km)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`接單半徑 ${km} 公里`}
                    className="mr-2"
                  >
                    <View
                      className={`h-12 w-12 items-center justify-center rounded-2xl border-2 ${
                        on ? 'border-silver-dark bg-silver-light' : 'border-wood-100 bg-white'
                      }`}
                    >
                      <Text className={`text-base font-black ${on ? 'text-silver-dark' : 'text-ink'}`}>{km}</Text>
                      <Text className={`text-[9px] ${on ? 'text-silver-dark' : 'text-mute'}`}>km</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text className="mt-2 text-xs text-mute">
              任務池只抓取你 <Text className="font-bold text-ink">{radius} 公里</Text> 內的呼救
            </Text>
          </>
        ) : (
          <View className="flex-row items-center rounded-2xl border border-wood-200 bg-wood-50 px-4 py-3">
            <MaterialCommunityIcons name="crown-outline" size={18} color="#9A763C" />
            <Text className="ml-2 flex-1 text-xs leading-5 text-wood-600">
              升上「拖鞋仙人」（累積 20 趟任務）即可自訂 1～5 公里接單範圍。目前固定 {radius} 公里。
            </Text>
          </View>
        )}

        {/* 白金安全徽章（認證完成才出現）*/}
        {verified && (
          <Animated.View
            className="mt-4 overflow-hidden rounded-[28px] bg-silver p-5"
            style={[{ transform: [{ scale: badgeScale }], opacity: reveal }, shadowSoft]}
          >
            <View className="flex-row items-center">
              <View className="h-14 w-14 items-center justify-center rounded-2xl bg-white/40">
                <MaterialCommunityIcons name="shield-crown" size={30} color="#FFFFFF" />
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-xl font-black text-white">白金安全徽章</Text>
                <Text className="mt-0.5 text-xs font-semibold text-silver-light">
                  已通過實名驗證{verification.police ? '・含良民證' : ''}，金主更安心
                </Text>
              </View>
            </View>
          </Animated.View>
        )}

        {/* 實名與安全認證 */}
        <View className="mb-3 mt-6 flex-row items-center">
          <MaterialCommunityIcons name="card-account-details-outline" size={18} color="#2A2521" />
          <Text className="ml-2 text-base font-black text-ink">實名與安全認證</Text>
        </View>
        <Text className="mb-4 text-xs text-mute">
          上傳身分證正反面完成實名，即可解鎖白金安全徽章。良民證為加分項，能接更高單價任務。
        </Text>

        <UploadRow
          icon="card-account-details"
          label="身分證・正面"
          hint="請確保四角清晰、字跡可辨識"
          done={verification.idFront}
          onUpload={() => upload('idFront')}
          onRemove={() => remove('idFront')}
        />
        <UploadRow
          icon="card-account-details-outline"
          label="身分證・反面"
          hint="需顯示完整地址與發證資訊"
          done={verification.idBack}
          onUpload={() => upload('idBack')}
          onRemove={() => remove('idBack')}
        />

        <View className="mb-2 mt-4 flex-row items-center">
          <Text className="text-sm font-bold text-ink">良民證</Text>
          <View className="ml-2 rounded-full bg-silver-light px-2 py-0.5">
            <Text className="text-[10px] font-bold text-silver-dark">選填・加分</Text>
          </View>
        </View>
        <UploadRow
          icon="file-certificate-outline"
          label="警察刑事紀錄證明"
          hint="可大幅提升金主信任與接單機會"
          done={verification.police}
          onUpload={() => upload('police')}
          onRemove={() => remove('police')}
        />

        {!verified && (
          <View className="mt-2 flex-row items-start rounded-2xl border border-wood-200 bg-wood-50 px-4 py-3">
            <MaterialCommunityIcons name="information-outline" size={16} color="#9A763C" />
            <Text className="ml-2 flex-1 text-xs leading-5 text-wood-600">
              完成身分證正反面上傳後，系統會在 1 個工作天內審核，通過即頒發白金安全徽章。
            </Text>
          </View>
        )}

        {/* 登出 */}
        <Pressable
          onPress={() => signOut()}
          accessibilityRole="button"
          accessibilityLabel="登出"
          className="mt-8"
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
