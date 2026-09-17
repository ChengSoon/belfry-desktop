import { openUrl } from "@tauri-apps/plugin-opener";

// Tauri 2 会在 window 上注入 __TAURI_INTERNALS__，存在即说明跑在桌面外壳里。
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * 打开外部 URL。
 *
 * Tauri 的 webview 里 window.open 打不开系统浏览器（调用会被静默丢弃），
 * 必须经 opener 插件走原生调用。浏览器开发环境退回 window.open。
 *
 * 后端 open_url 会按 capability 里的 scope 校验 URL，被拒时抛 ForbiddenUrl。
 * 调用点一律 `void` 掉返回值，这里不落日志的话失败就只剩「点了没反应」。
 */
export async function openExternal(href: string): Promise<void> {
  if (IN_TAURI) {
    try {
      await openUrl(href);
    } catch (error) {
      console.error("[openExternal] 打开外部链接失败:", href, error);
    }
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
