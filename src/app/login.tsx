import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MosaicTarget } from '@/components/mosaic-target';
import { BRAND } from '@/constants/brand';
import { shadowSoft, shadowSos } from '@/constants/shadows';
import { requestOtp, verifyOtp } from '@/lib/auth';
import { selectHaptic, successHaptic } from '@/lib/haptics';

export default function LoginScreen() {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otpRef = useRef<TextInput>(null);

  const phoneValid = phone.replace(/\D/g, '').length >= 9;
  // 台灣號碼轉 E.164（去開頭 0）
  const e164 = `+886${phone.replace(/^0/, '')}`;

  const sendOtp = async () => {
    if (!phoneValid || busy) return;
    selectHaptic();
    setBusy(true);
    setError(null);
    const { error } = await requestOtp(e164);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setStep('otp');
    setTimeout(() => otpRef.current?.focus(), 350);
  };

  const submit = async () => {
    if (otp.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    const { error } = await verifyOtp(e164, otp);
    setBusy(false);
    if (error) {
      setError(error);
      setOtp('');
      return;
    }
    successHaptic(); // 登入狀態由 Supabase/mock 寫入 → Stack.Protected 自動切到首頁
  };

  const onOtpChange = (t: string) => {
    const v = t.replace(/\D/g, '').slice(0, 6);
    setOtp(v);
    setError(null);
    if (v.length === 6) submit(); // 自動送出，避免鍵盤擋住按鈕
  };

  return (
    <SafeAreaView className="flex-1 bg-paper">
      <View className="flex-1 px-6 pt-4">
        {step === 'otp' && (
          <Pressable
            onPress={() => {
              setStep('phone');
              setError(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="返回上一步"
            hitSlop={10}
            className="h-10 w-10 items-center justify-center rounded-full bg-cream"
            style={shadowSoft}
          >
            <Ionicons name="chevron-back" size={22} color="#2A2521" />
          </Pressable>
        )}

        {/* 品牌 */}
        <View className="mt-8 items-center">
          <View className="h-20 w-20 items-center justify-center rounded-3xl bg-cream" style={shadowSoft}>
            <MosaicTarget size={44} />
          </View>
          <Text className="mt-4 text-3xl font-black text-ink">{BRAND.appName}</Text>
          <Text className="mt-1 text-sm text-mute">{BRAND.tagline}</Text>
        </View>

        {step === 'phone' ? (
          <View className="mt-12">
            <Text className="mb-2 text-sm font-bold text-ink">手機號碼</Text>
            <View className="flex-row items-center rounded-2xl border border-wood-200 bg-white px-4" style={shadowSoft}>
              <Text className="text-base font-bold text-ink">+886</Text>
              <View className="mx-3 h-6 w-px bg-wood-100" />
              <TextInput
                value={phone}
                onChangeText={(t) => setPhone(t.replace(/[^\d]/g, '').slice(0, 10))}
                placeholder="912 345 678"
                placeholderTextColor="#C9C2B6"
                keyboardType="phone-pad"
                className="h-14 flex-1 text-base text-ink"
                accessibilityLabel="手機號碼輸入"
              />
            </View>
            <Text className="mt-2 text-xs text-mute">會傳一組 6 位數驗證碼給你</Text>
            {error && <Text className="mt-2 text-xs font-semibold text-sos">{error}</Text>}

            <Pressable
              onPress={sendOtp}
              disabled={!phoneValid || busy}
              accessibilityRole="button"
              accessibilityLabel="發送驗證碼"
              className="mt-6"
              style={({ pressed }) => [
                phoneValid && !busy ? shadowSos : undefined,
                { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: phoneValid && !busy ? 1 : 0.4 },
              ]}
            >
              <View className="items-center rounded-2xl bg-sos py-4">
                <Text className="text-lg font-black text-white">{busy ? '傳送中…' : '發送驗證碼'}</Text>
              </View>
            </Pressable>
          </View>
        ) : (
          <View className="mt-12">
            <Text className="mb-2 text-sm font-bold text-ink">輸入驗證碼</Text>
            <Text className="mb-5 text-xs text-mute">已傳送至 {e164}</Text>

            {/* 6 格 OTP：以透明覆蓋輸入框承接鍵盤輸入 */}
            <View className="relative">
              <View className="flex-row justify-between">
                {Array.from({ length: 6 }).map((_, i) => {
                  const filled = i < otp.length;
                  const active = i === otp.length;
                  return (
                    <View
                      key={i}
                      className={`h-14 w-12 items-center justify-center rounded-2xl border-2 ${
                        active ? 'border-sos bg-sos/10' : filled ? 'border-wood-300 bg-white' : 'border-wood-100 bg-white'
                      }`}
                      style={shadowSoft}
                    >
                      <Text className="text-2xl font-black text-ink">{otp[i] ?? ''}</Text>
                    </View>
                  );
                })}
              </View>
              <TextInput
                ref={otpRef}
                value={otp}
                onChangeText={onOtpChange}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                caretHidden
                editable={!busy}
                className="absolute inset-0"
                style={{ color: 'transparent' }}
                accessibilityLabel="6 位數驗證碼輸入"
              />
            </View>

            {error && <Text className="mt-3 text-xs font-semibold text-sos">{error}</Text>}

            <Pressable
              onPress={submit}
              disabled={otp.length !== 6 || busy}
              accessibilityRole="button"
              accessibilityLabel="驗證並登入"
              className="mt-8"
              style={({ pressed }) => [
                otp.length === 6 && !busy ? shadowSos : undefined,
                { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: otp.length === 6 && !busy ? 1 : 0.4 },
              ]}
            >
              <View className="items-center rounded-2xl bg-sos py-4">
                <Text className="text-lg font-black text-white">{busy ? '驗證中…' : '驗證並登入'}</Text>
              </View>
            </Pressable>

            <Pressable onPress={sendOtp} disabled={busy} className="mt-4 items-center" hitSlop={8}>
              <Text className="text-xs font-semibold text-mute">沒收到？重新發送</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
