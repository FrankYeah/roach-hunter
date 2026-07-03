import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { shadowSoft } from '@/constants/shadows';
import { fetchMessages, sendMessage, subscribeMessages, type Message } from '@/lib/chat';
import { notifyNewMessage } from '@/lib/push';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * 即時聊天框（求救端 / 獵人端共用）。
 * 真實模式：抓歷史訊息 + 訂閱 messages 表 INSERT，雙向即時。送出靠 Realtime 回補
 *   （含自己），故不另做樂觀更新，並以 id 去重避免初次抓取與訂閱事件重複。
 * mock 模式（未設定 Supabase / 無 orderId）：本地回顯，讓 demo 仍可操作。
 */
export function ChatBox({
  orderId,
  selfId,
  peerName,
}: {
  orderId: string | null;
  selfId: string | null;
  peerName: string;
}) {
  const configured = isSupabaseConfigured;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!configured || !orderId) return;
    let active = true;
    fetchMessages(orderId).then((ms) => active && setMessages(ms));
    const unsub = subscribeMessages(orderId, (m) =>
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m])),
    );
    return () => {
      active = false;
      unsub();
    };
  }, [configured, orderId]);

  // 新訊息進來自動捲到底
  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    if (configured && orderId) {
      setSending(true);
      const { error } = await sendMessage(orderId, selfId, text);
      setSending(false);
      if (error) setInput(text); // 失敗還原輸入；成功靠 Realtime 回補訊息
      else notifyNewMessage(orderId, text); // 推播給對方（離線也收得到，fire-and-forget）
    } else {
      // mock：本地回顯
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          order_id: orderId ?? '',
          sender_id: selfId,
          content: text,
          created_at: new Date().toISOString(),
        },
      ]);
    }
  };

  const canSend = input.trim().length > 0 && !sending;

  return (
    <View className="rounded-3xl bg-cream p-3" style={shadowSoft}>
      <ScrollView
        ref={listRef}
        style={{ maxHeight: 240 }}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: 4 }}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <Text className="py-8 text-center text-xs text-mute">還沒有訊息，傳第一則打聲招呼吧 👋</Text>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === selfId;
            return (
              <View key={m.id} className={`mb-2 max-w-[80%] ${mine ? 'self-end' : 'self-start'}`}>
                <View className={`rounded-2xl px-3 py-2 ${mine ? 'rounded-tr-md bg-sos' : 'rounded-tl-md bg-white'}`}>
                  <Text className={`text-sm ${mine ? 'text-white' : 'text-ink'}`}>{m.content}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View className="mt-2 flex-row items-center rounded-full bg-white px-3 py-1.5">
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={`傳訊息給 ${peerName}…`}
          placeholderTextColor="#C4BCB0"
          className="flex-1 text-sm text-ink"
          onSubmitEditing={send}
          returnKeyType="send"
          blurOnSubmit={false}
          accessibilityLabel="輸入訊息"
        />
        <Pressable
          onPress={send}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="送出訊息"
          className="ml-2 h-9 w-9 items-center justify-center rounded-full bg-sos"
          style={{ opacity: canSend ? 1 : 0.45 }}
        >
          <Ionicons name="send" size={15} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}
