import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

/**
 * 「震動的黑色馬賽克方塊 / 像素風外星小怪獸」
 *
 * 視覺避諱核心元件：全 App 用它來隱喻「那個」，
 * 絕不出現任何寫實或卡通蟲體、觸角、蟲腳。
 *
 * 由 5x5 像素點陣組成一隻會輕微震動的黑色小怪獸。
 */

// 1 = 黑色像素，0 = 留空。刻意做成像素小怪獸（有兩隻腳、中間留空當眼睛）。
const PIXELS = [
  [0, 1, 1, 1, 0],
  [1, 1, 1, 1, 1],
  [1, 1, 0, 1, 1],
  [1, 1, 1, 1, 1],
  [0, 1, 0, 1, 0],
];

interface MosaicTargetProps {
  /** 整體邊長（px） */
  size?: number;
  /** 是否震動 */
  vibrate?: boolean;
  /** 像素顏色（預設暖黑） */
  color?: string;
}

export function MosaicTarget({ size = 64, vibrate = true, color = '#2A2521' }: MosaicTargetProps) {
  const shake = useRef(new Animated.Value(0)).current;
  const cell = size / PIXELS.length;

  useEffect(() => {
    if (!vibrate) return;
    const loop = Animated.loop(
      Animated.sequence([
        // 一陣快速抖動，營造「牠在動」的臨場感
        Animated.timing(shake, { toValue: 1, duration: 65, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 65, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 1, duration: 65, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 65, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 65, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(600),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shake, vibrate]);

  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-2.5, 2.5] });
  const rotate = shake.interpolate({ inputRange: [-1, 1], outputRange: ['-4deg', '4deg'] });

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        transform: [{ translateX }, { rotate }],
      }}
    >
      {PIXELS.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((on, c) => (
            <View
              key={c}
              style={{
                width: cell,
                height: cell,
                backgroundColor: on ? color : 'transparent',
                borderRadius: cell * 0.18,
              }}
            />
          ))}
        </View>
      ))}
    </Animated.View>
  );
}
