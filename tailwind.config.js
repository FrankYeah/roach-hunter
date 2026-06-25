/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // 乾淨白底 + 暖白紙感
        paper: '#FFFFFF',
        cream: '#FBF6EE',
        // 淺木質調暖色塊
        wood: {
          50: '#FAF3E8',
          100: '#F2E4CE',
          200: '#E8D3AE',
          300: '#D9BD8B',
          400: '#C9A66B',
          500: '#B58E4F',
          600: '#9A763C',
        },
        // 金屬銀（高級徽章）
        silver: {
          light: '#EAEEF3',
          DEFAULT: '#C3C9D2',
          dark: '#969DA9',
        },
        // 呼救主色（夏日暖橘紅，緊張但仍 chill）
        sos: {
          light: '#FF8A6B',
          DEFAULT: '#FB6B4B',
          dark: '#E2553A',
        },
        // 暖黑：文字 & 「馬賽克方塊」隱喻
        ink: '#2A2521',
        mute: '#9A8F80',
        // 點綴：可用 / 上線狀態
        leaf: '#7FB069',
      },
      borderRadius: {
        '4xl': '32px',
      },
    },
  },
  plugins: [],
};
