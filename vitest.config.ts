import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  css: {
    // 根目录 postcss.config.mjs 是给 Next.js webpack 用的字符串写法（"@tailwindcss/postcss"），
    // Vite 的 postcss 加载器认不出这种写法。单测不需要处理 CSS，直接用空配置绕开自动探测。
    postcss: {},
  },
});
