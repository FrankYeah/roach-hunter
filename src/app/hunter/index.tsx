import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MosaicTarget } from '@/components/mosaic-target';
import { shadowSoft, shadowSos } from '@/constants/shadows';
import { PLATFORM_FEE_RATE, SOS_TASKS, netEarning, tierOf, type SosTask } from '@/data/tasks';
import { selectHaptic, successHaptic } from '@/lib/haptics';
import { useAppStore } from '@/store/useAppStore';

function TaskCard({ task, onAccept }: { task: SosTask; onAccept: () => void }) {
  const tier = tierOf(task);
  const net = netEarning(tier.price);

  return (
    <View className="mb-3 rounded-3xl bg-white p-4" style={shadowSoft}>
      <View className="flex-row items-center">
        <View className="h-14 w-14 items-center justify-center rounded-2xl bg-cream">
          <MosaicTarget size={28 + tier.mosaic * 7} />
        </View>
        <View className="ml-3 flex-1">
          <View className="flex-row items-center">
            <Text className="text-base font-black text-ink">{tier.label}</Text>
            <View className="ml-2 flex-row items-center">
              <Ionicons name="navigate" size={12} color="#9A8F80" />
              <Text className="ml-0.5 text-xs text-mute">{task.distanceM} m</Text>
            </View>
            <Text className="ml-2 text-xs text-mute">· {task.postedAgoMin} 分鐘前</Text>
          </View>
          <Text className="mt-0.5 text-sm font-semibold text-ink">{task.address}</Text>
          <Text className="mt-0.5 text-xs text-mute" numberOfLines={1}>
            「{task.note}」
          </Text>
        </View>
      </View>

      <View className="my-3 h-px bg-wood-100" />

      <View className="flex-row items-end justify-between">
        <View>
          <Text className="text-[11px] text-mute">
            訂單 ${tier.price}・平台抽 {Math.round(PLATFORM_FEE_RATE * 100)}%
          </Text>
          <View className="mt-0.5 flex-row items-end">
            <Text className="text-xs font-semibold text-leaf">淨收益 </Text>
            <Text className="text-2xl font-black text-leaf">${net}</Text>
          </View>
        </View>
        <Pressable
          onPress={onAccept}
          accessibilityRole="button"
          accessibilityLabel={`接單，${tier.label}，淨收益 ${net} 元`}
          style={({ pressed }) => [shadowSos, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}
        >
          <View className="flex-row items-center rounded-2xl bg-sos px-5 py-2.5">
            <FontAwesome5 name="shoe-prints" size={13} color="#FFFFFF" />
            <Text className="ml-2 text-base font-black text-white">接單</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export default function HunterPoolScreen() {
  const toggleRole = useAppStore((s) => s.toggleRole);
  const acceptTask = useAppStore((s) => s.acceptTask);

  const backToRequester = () => {
    selectHaptic();
    toggleRole();
    router.replace('/');
  };

  const accept = (task: SosTask) => {
    successHaptic();
    acceptTask(task.id);
    router.push('/hunter/task');
  };

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      {/* 頂部 */}
      <View className="flex-row items-center justify-between px-5 pb-3 pt-1">
        <View>
          <View className="flex-row items-center">
            <Text className="text-2xl font-black text-ink">任務池</Text>
            <View className="ml-2 flex-row items-center rounded-full bg-leaf/15 px-2 py-0.5">
              <View className="mr-1 h-2 w-2 rounded-full bg-leaf" />
              <Text className="text-[11px] font-bold text-leaf">上線中</Text>
            </View>
          </View>
          <Text className="mt-0.5 text-xs text-mute">附近有 {SOS_TASKS.length} 筆呼救等你出動・拖鞋見習生</Text>
        </View>
        <Pressable
          onPress={backToRequester}
          accessibilityRole="button"
          accessibilityLabel="切換為求救者身分"
          className="flex-row items-center rounded-full bg-cream px-3 py-1.5"
          style={shadowSoft}
        >
          <MaterialCommunityIcons name="swap-horizontal" size={16} color="#9A763C" />
          <Text className="ml-1 text-xs font-bold text-ink">求救者</Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {SOS_TASKS.map((task) => (
          <TaskCard key={task.id} task={task} onAccept={() => accept(task)} />
        ))}
        <Text className="mt-2 text-center text-[11px] text-mute">已經到底囉，等更多金主呼救中…</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
