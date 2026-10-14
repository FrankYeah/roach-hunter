# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# 相依套件（npm audit）

- **驗收不要跑 `npm run lint`。** 這個 repo 沒有 ESLint 設定，`expo lint` 會自己 `npm install` eslint 與
  eslint-config-expo，改寫 package.json、整棵重新解析 lockfile，還生出 `eslint.config.js`（2026-10-14 實測）。
  型別檢查用 `npx tsc --noEmit`。
- **基準是剩 12 條 advisory**（2026-10-14 起；筆數會跟著相依樹變，判準看編號），全部在 Expo SDK 54 自己釘住的
  版本裡，升 Expo SDK 才會動：
  - 上游沒有修補版：GHSA-vfj7-8cjw-p6xm（braces，Tailwind 3 掃檔）、GHSA-86w9-cpqp-85rv（node-forge，
    @expo/cli 的 code signing）、GHSA-ch52-4w7c-c8xp（http-cache-semantics，@expo/ngrok）、
    GHSA-hp3w-g68c-fv3c（sprintf-js，istanbul）
  - 被 Expo 的套件釘住：postcss 8.4.49（@expo/metro-config；GHSA-qx2v-qp2m-jg93、GHSA-6g55-p6wh-862q、
    GHSA-fxqj-rqcc-2cmp、GHSA-r28c-9q8g-f849）、image-size 1.2.1（metro；GHSA-5p2g-fcmc-qvqq、
    GHSA-w3rx-r6r6-pgpr）、uuid（@expo/ngrok 與 config-plugins；GHSA-w5hq-g745-h8pq）、
    decode-uri-component 0.2.2（expo-router → query-string；GHSA-vcc3-ghjq-m6fr，這條會打包進 app）
  - 多出別條就照全域 skill `npm-audit-triage` 分流，不要跑 `npm audit fix`。
- **`package.json` 的 `overrides` 把 postcss-selector-parser 拉到 ^7.1.6 是刻意的**（GHSA-rj75-hqrm-r3gf；
  NativeWind 用的 Tailwind 3.4.19 宣告 ^6.1.2，修補只出在 7.x）。2026-10-14 驗過 `npx tailwindcss -i src/global.css`
  的未壓縮輸出修前修後逐位元組相同。換成不用 Tailwind 3 的 NativeWind 時一起拿掉。
