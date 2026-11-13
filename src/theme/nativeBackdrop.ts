import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ThemeMode } from "./contracts";

/**
 * 把当前主题告诉原生层：同步窗口底色（resize 新露出的边缘、内容面四周的缝），
 * 首次调用时还会显示以 `visible: false` 启动的主窗口（见 src-tauri/src/window_reveal.rs）。
 *
 * 首次调用等两帧再发：第一帧用于提交 React 渲染，第二帧回调时它已经画出来，窗口一出现就是
 * 正确主题，不会先露出 WebView 的默认底色。之后的切换不需要等。
 * 不在 Tauri 里（浏览器夹具、单测）时什么都不做。失败只记日志：底色是锦上添花，
 * 窗口显示另有原生侧 3 秒超时兜底。
 */
let revealed = false;

export function syncNativeBackdrop(mode: ThemeMode, raf: (callback: () => void) => unknown = requestAnimationFrame) {
  if (!isTauri()) return;
  const send = () => void invoke("app_window_backdrop", { theme: mode })
    .catch((error: unknown) => console.warn("Cannot sync native window backdrop", error));
  if (revealed) { send(); return; }
  revealed = true;
  raf(() => raf(send));
}

/** 仅供测试复位模块状态。 */
export function resetNativeBackdropForTest() { revealed = false; }
