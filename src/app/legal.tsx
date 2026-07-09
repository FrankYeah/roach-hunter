import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BRAND } from '@/constants/brand';
import { shadowSoft } from '@/constants/shadows';

/**
 * 隱私權政策 + 服務條款（單一畫面，上方切換）。
 * ⚠️ 以下為「範本草稿」，內容依 App 實際行為擬定，但**上線前請務必由你本人或
 * 法務再次確認 / 補上真實聯絡方式**。App Store / Play 另需一個「可公開存取的網址」
 * 版本填進商店後台，不能只有 App 內頁。
 */

type Doc = 'privacy' | 'terms';
type Section = { h: string; body: string };

const PRIVACY: Section[] = [
  {
    h: '一、我們蒐集哪些資料',
    body: '為提供媒合與安全服務，我們會蒐集：手機號碼（登入驗證）、你的位置（媒合、顯示距離與預計抵達時間）、獵人的實名認證文件（身分證件、良民證）、你在訂單中填寫的精確地址與進入指引、你與對方的聊天訊息、以及裝置推播權杖。',
  },
  {
    h: '二、如何使用這些資料',
    body: '用於：媒合求救者與獵人、計算距離／ETA、進行實名（KYC）審核、處理爭議與檢舉、發送任務相關推播、以及防詐與濫用防護。我們不會將你的個資販售給第三方。',
  },
  {
    h: '三、資料保留與刪除',
    body: '為保護隱私，訂單結案滿 30 天後，我們會自動清除該訂單的精確地址與進入指引。你可隨時於「個人設定 → 永久刪除帳號」刪除帳號，這會移除你的個人資料、錢包紀錄與認證檔案（進行中的訂單需先完成或取消）。',
  },
  {
    h: '四、第三方服務',
    body: '我們使用 Supabase 提供資料庫、身分驗證與檔案儲存，使用 Expo 推播服務發送通知。這些服務僅為運作本 App 所必需，受其各自的隱私政策規範。',
  },
  {
    h: '五、你的權利',
    body: '你有權查詢、更正或刪除你的個人資料。刪除可直接在 App 內完成；其他需求請透過下方客服信箱與我們聯繫。',
  },
  {
    h: '六、聯絡我們',
    body: '如對本政策有任何疑問，請來信客服信箱（上線前請填入真實信箱）。',
  },
];

const TERMS: Section[] = [
  {
    h: '一、服務性質',
    body: `${BRAND.appName} 是一個「媒合平台」，協助有需求的求救者與提供服務的獵人相互連結。平台本身不直接提供現場服務，亦不對服務結果作絕對保證。`,
  },
  {
    h: '二、帳號',
    body: '你須提供正確、真實的註冊資訊，並為帳號下的所有活動負責。禁止冒用他人身分或提供虛假認證文件。',
  },
  {
    h: '三、費用與金流',
    body: '訂單賞金於發起時顯示；平台抽成 15%。若目標逃逸（撲空），獵人可獲固定車馬費 $150，其餘退回求救者儲值金。獵人已出發後由求救者中途取消，將收取 $100 出勤補償金。目前平台金流為測試／模擬性質，未串接真實金流。',
  },
  {
    h: '四、使用者行為',
    body: '禁止任何騷擾、詐騙、暴力或違法行為。你可對不當使用者提出檢舉或封鎖；平台得依情節對違規帳號警告或暫停接單。',
  },
  {
    h: '五、免責聲明',
    body: '在法律允許範圍內，平台不對使用者之間於現場發生的人身或財物損害負責。（此為範本，上線前請由法律專業人士確認合適的免責與責任範圍。）',
  },
  {
    h: '六、條款變更',
    body: '我們保留隨時修改本條款的權利；重大變更將於 App 內公告。你於變更後繼續使用即視為同意。',
  },
];

export default function LegalScreen() {
  const params = useLocalSearchParams<{ doc?: string }>();
  const [doc, setDoc] = useState<Doc>(params.doc === 'terms' ? 'terms' : 'privacy');
  const sections = doc === 'privacy' ? PRIVACY : TERMS;

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      <View className="flex-row items-center px-4 pb-2 pt-1">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          className="h-10 w-10 items-center justify-center rounded-full bg-cream"
        >
          <Ionicons name="chevron-back" size={22} color="#2A2521" />
        </Pressable>
        <Text className="ml-3 text-xl font-black text-ink">條款與隱私</Text>
      </View>

      {/* 切換 */}
      <View className="mx-5 mt-2 flex-row rounded-full bg-cream p-1">
        {(['privacy', 'terms'] as Doc[]).map((d) => {
          const on = doc === d;
          return (
            <Pressable
              key={d}
              onPress={() => setDoc(d)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              className="flex-1 items-center rounded-full py-2"
              style={on ? [{ backgroundColor: '#FFFFFF' }, shadowSoft] : undefined}
            >
              <Text className={`text-sm font-bold ${on ? 'text-ink' : 'text-mute'}`}>
                {d === 'privacy' ? '隱私權政策' : '服務條款'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 範本提醒 */}
        <View
          className="mt-3 flex-row items-start rounded-2xl bg-wood-50 px-4 py-3"
          style={shadowSoft}
        >
          <Ionicons name="information-circle-outline" size={16} color="#9A763C" />
          <Text className="ml-2 flex-1 text-[11px] leading-5 text-wood-600">
            本內容為範本草稿，依 App 實際行為擬定；上線前請由你或法務確認並補上真實聯絡方式。
          </Text>
        </View>

        {sections.map((s) => (
          <View key={s.h} className="mt-4 rounded-3xl bg-white p-4" style={shadowSoft}>
            <Text className="text-sm font-black text-ink">{s.h}</Text>
            <Text className="mt-1.5 text-xs leading-6 text-mute">{s.body}</Text>
          </View>
        ))}

        <Text className="mt-5 text-center text-[11px] text-mute">最後更新：上線前請填入日期</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
