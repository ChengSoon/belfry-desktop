import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // 仓库里的 node:test 用例（docs/ 下带 .test.mjs 的浏览器夹具）不走 vitest，别把它们收集进来。
    exclude: [...configDefaults.exclude, "docs/**"],
  },
  clearScreen: false,
  server: {
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
