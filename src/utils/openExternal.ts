import { invoke } from "@tauri-apps/api/core";

// Tauri 2 会在 window 上注入 __TAURI_INTERNALS__，存在即说明跑在桌面外壳里。
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * 打开外部 URL。
 *
 * Tauri 的 webview 里 window.open 打不开系统浏览器（调用会被静默丢弃），
 * 必须走宿主的 open_external 后端命令调系统原生打开方式。浏览器开发环境
 * （如 vite dev server 直开）退回 window.open。
 */
export async function openExternal(href: string): Promise<void> {
  if (!IN_TAURI) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await invoke("open_external", { url: href });
  } catch (error) {
    // 调用点多是 void openExternal(...)，rejection 无人接手；这里留一条日志，
    // 免得「点了没反应」又变成没有任何线索的哑故障。
    console.error("[openExternal] 打开失败", href, error);
    throw error;
  }
}
