import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import canvas from "./src/theme/canvas.json" with { type: "json" };
import backdrop from "./src/theme/backdrop.json" with { type: "json" };
import { themeCanvasPlugin } from "./scripts/theme-canvas.ts";

export default defineConfig({
  plugins: [themeCanvasPlugin(canvas, backdrop), react(), tailwindcss()],
  test: {
    // node:test suites are executed by their own CI steps, not by Vitest.
    exclude: [...configDefaults.exclude, "docs/**", "scripts/backend-i18n.test.mjs"],
  },
  clearScreen: false,
  server: {
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
