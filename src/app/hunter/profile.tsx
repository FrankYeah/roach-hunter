import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LevelBadge } from '@/components/level-badge';
import { levelFromCompleted } from '@/constants/brand';
import { shadowSoft } from '@/constants/shadows';
import { signOut } from '@/lib/auth';
import { selectHaptic, successHaptic } from '@/lib/haptics';
import { fetchProfile, updateProfile, type Gender, type Profile, type VerifyStatus } from '@/lib/profiles';
import { uploadVerificationDoc, type VerifyDoc } from '@/lib/storage';
import { useAppStore } from '@/store/useAppStore';

const GENDERS: { id: Gender; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'male', label: '男性', icon: 'male' },
  { id: 'female', label: '女性', icon: 'female' },
  { id: 'unspecified', label: '不公開', icon: 'remove-circle-outline' },
];

/** KYC 文件列：依認證狀態決定外觀（未上傳 / 審核中鎖定 / 已通過 / 退件重傳）*/
function DocStatusRow({
  icon,
  label,
  hint,
  status,
  busy,
  onUpload,
}: {
  icon: string;
  label: string;
  hint: string;
  status: VerifyStatus;
  busy: boolean;
  onUpload: () => void;
}) {
  const verified = status === 'verified';
  const pending = status === 'pending';
  const rejected = status === 'rejected';
  return (
    <View
      className={`mb-3 flex-row items-center rounded-3xl border-2 px-4 py-3.5 ${
        verified
          ? 'border-leaf bg-leaf/10'
          : pending
            ? 'border-silver bg-silver-light/50'
            : rejected
              ? 'border-sos bg-sos/5'
              : 'border-dashed border-wood-300 bg-white'
      }`}
      style={verified || pending ? undefined : shadowSoft}
    >
      <View
        className={`h-12 w-12 items-center justify-center rounded-2xl ${
          verified ? 'bg-leaf' : pending ? 'bg-silver' : 'bg-cream'
        }`}
      >
        {verified ? (
          <Ionicons name="checkmark" size={24} color="#FFFFFF" />
        ) : pending ? (
          <MaterialCommunityIcons name="clock-outline" size={22} color="#FFFFFF" />
        ) : (
          <MaterialCommunityIcons name={icon as never} size={22} color="#9A763C" />
        )}
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-sm font-bold text-ink">{label}</Text>
        <Text className={`text-xs ${rejected ? 'text-sos' : 'text-mute'}`}>
          {verified
            ? '已通過審核'
            : pending
              ? '平台人工審核中…約 1 個工作天'
              : rejected
                ? '未通過，請重新上傳'
                : hint}
        </Text>
      </View>
      {verified ? (
        <Ionicons name="shield-checkmark" size={20} color="#7FB069" />
      ) : pending ? (
        <View className="flex-row items-center rounded-full bg-white px-3 py-2">
          <ActivityIndicator size="small" color="#9A763C" />
          <Text className="ml-1.5 text-xs font-bold text-wood-600">審核中</Text>
        </View>
      ) : (
        <Pressable
          onPress={onUpload}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`上傳${label}`}
          style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.96 : 1 }], opacity: busy ? 0.6 : 1 }]}
        >
          <View className="flex-row items-center rounded-full bg-sos px-4 py-2">
            {busy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="cloud-upload-outline" size={15} color="#FFFFFF" />
            )}
            <Text className="ml-1 text-xs font-black text-white">{busy ? '上傳中' : rejected ? '重傳' : '上傳'}</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

export default function HunterProfileScreen() {
  const userId = useAppStore((s) => s.userId);

  // 讀取自己的 profile：回填等級、性別、接單半徑、與「跨裝置保留」的認證狀態
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gender, setGender] = useState<Gender>('unspecified');
  const [radius, setRadius] = useState(2);
  const [idStatus, setIdStatus] = useState<VerifyStatus>('none');
  const [policeStatus, setPoliceStatus] = useState<VerifyStatus>('none');
  const [uploading, setUploading] = useState<VerifyDoc | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchProfile(userId).then((p) => {
      if (!active || !p) return;
      setProfile(p);
      setGender(p.gender);
      setRadius(p.search_radius_km);
      setIdStatus(p.id_verification_status);
      setPoliceStatus(p.police_verification_status);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const level = levelFromCompleted(profile?.completed_tasks ?? 0);
  const isMaster = level.id === 'master'; // 拖鞋仙人才解鎖自訂接單範圍
  const idVerified = idStatus === 'verified';

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

  // 選相片 → 上傳 Storage → 狀態切「審核中(pending)」並鎖定上傳鈕
  const pickAndUpload = async (doc: VerifyDoc) => {
    if (uploading) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('需要相簿權限', '請允許存取相片，才能上傳實名認證文件');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (res.canceled || !res.assets?.length) return;

    setUploading(doc);
    const { error } = await uploadVerificationDoc(userId, doc, res.assets[0].uri);
    if (error) {
      Alert.alert('上傳失敗', error);
      setUploading(null);
      return;
    }
    // 上傳成功 → 狀態 pending（DB + 本地）
    if (doc === 'id') {
      await updateProfile(userId, { id_verification_status: 'pending' });
      setIdStatus('pending');
    } else {
      await updateProfile(userId, { police_verification_status: 'pending' });
      setPoliceStatus('pending');
    }
    setUploading(null);
    successHaptic();
    Alert.alert('已送出審核', '文件已上傳，平台人工審核中（約 1 個工作天）');
  };

  // 白金徽章彈入動畫（身分證件通過審核才出現）
  const reveal = useRef(new Animated.Value(0)).current;
  const wasVerified = useRef(false);
  useEffect(() => {
    Animated.spring(reveal, {
      toValue: idVerified ? 1 : 0,
      friction: 6,
      tension: 70,
      useNativeDriver: true,
    }).start();
    if (idVerified && !wasVerified.current) successHaptic();
    wasVerified.current = idVerified;
  }, [idVerified, reveal]);

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
              {idVerified && (
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

        {/* 歷史訂單與錢包明細入口 */}
        <Pressable
          onPress={() => router.push('/history')}
          accessibilityRole="button"
          accessibilityLabel="歷史訂單與錢包明細"
          className="mt-3 flex-row items-center rounded-3xl bg-white px-4 py-3.5"
          style={shadowSoft}
        >
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-cream">
            <MaterialCommunityIcons name="history" size={20} color="#9A763C" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-sm font-bold text-ink">歷史訂單與錢包明細</Text>
            <Text className="text-[11px] text-mute">查看接單收入與撲空車馬費入帳</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#C4BCB0" />
        </Pressable>

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

        {/* 白金安全徽章（身分證件通過審核才出現）*/}
        {idVerified && (
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
                  已通過實名驗證{policeStatus === 'verified' ? '・含良民證' : ''}，金主更安心
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
          上傳身分證件完成實名，平台人工審核通過即解鎖白金安全徽章。良民證為加分項，能接更高單價任務。
        </Text>

        <DocStatusRow
          icon="card-account-details"
          label="身分證件"
          hint="請上傳清晰的身分證照片"
          status={idStatus}
          busy={uploading === 'id'}
          onUpload={() => pickAndUpload('id')}
        />

        <View className="mb-2 mt-4 flex-row items-center">
          <Text className="text-sm font-bold text-ink">良民證</Text>
          <View className="ml-2 rounded-full bg-silver-light px-2 py-0.5">
            <Text className="text-[10px] font-bold text-silver-dark">選填・加分</Text>
          </View>
        </View>
        <DocStatusRow
          icon="file-certificate-outline"
          label="警察刑事紀錄證明"
          hint="可大幅提升金主信任與接單機會"
          status={policeStatus}
          busy={uploading === 'police'}
          onUpload={() => pickAndUpload('police')}
        />

        {idStatus !== 'verified' && (
          <View className="mt-2 flex-row items-start rounded-2xl border border-wood-200 bg-wood-50 px-4 py-3">
            <MaterialCommunityIcons name="information-outline" size={16} color="#9A763C" />
            <Text className="ml-2 flex-1 text-xs leading-5 text-wood-600">
              上傳後系統會在 1 個工作天內由平台人工審核，通過即頒發白金安全徽章並享優先派單。
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
