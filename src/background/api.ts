import { invoke } from "@tauri-apps/api/core";
import type { BackgroundAsset } from "./contracts";

export function importBackground(source: string) {
  return invoke<BackgroundAsset>("background_import", { source });
}

/**
 * 拿的是原始字节，不是 base64 —— 后端走 IPC 的 raw body 回传，
 * 几 MB 的图不会因为编码多出三分之一。
 */
export function readBackground() {
  return invoke<ArrayBuffer>("background_read");
}

export function removeBackground() {
  return invoke<void>("background_remove");
}
