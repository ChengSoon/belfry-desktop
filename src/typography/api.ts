import { invoke } from "@tauri-apps/api/core";
import type { ImportedFontAsset } from "./contracts";

export function importFont(source: string) {
  return invoke<ImportedFontAsset>("font_import", { source });
}

/** 字体字节通过 raw IPC 返回，避免 base64 膨胀。 */
export function readFont(fileName: string) {
  return invoke<ArrayBuffer>("font_read", { fileName });
}

export function removeFont(fileName: string) {
  return invoke<void>("font_remove", { fileName });
}
