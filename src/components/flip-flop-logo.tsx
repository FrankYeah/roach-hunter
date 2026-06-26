import Svg, { Circle, Path } from 'react-native-svg';

/**
 * 極簡線條風「夾腳拖」品牌 Logo（俯視、腳尖朝上）。
 * 純線條 + 趾夾 Y 字鞋帶，刻意避開台式藍白拖的厚重視覺。
 * 顏色預設淺木質調，可由 color 覆寫以配合不同底色。
 */
export function FlipFlopLogo({ size = 28, color = '#9A763C' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 鞋底外框 */}
      <Path
        d="M12 2.6C14.8 2.6 17 4.8 17 9C17 14 15.5 20.5 12 21C8.5 20.5 7 14 7 9C7 4.8 9.2 2.6 12 2.6Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      {/* 夾腳 Y 字鞋帶 */}
      <Path d="M12 6.8L9 12.6" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M12 6.8L15 12.6" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      {/* 趾夾結 */}
      <Circle cx={12} cy={6} r={1} fill={color} />
    </Svg>
  );
}
