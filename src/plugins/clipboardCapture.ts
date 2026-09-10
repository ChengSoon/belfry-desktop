import { useEffect } from "react";
import { pluginHost } from "./useDirectoryRegistry";

const IMAGE_LIMIT = 50 * 1024 * 1024;
const TEXT_LIMIT = 100 * 1024;
const CHUNK_BYTES = 128 * 1024;
const STRING_BLOCK = 16 * 1024;
const capture = (method: string, params: Record<string, unknown>) => pluginHost.requestRuntime(`clipboard.capture.${method}`, params);

function encoded(bytes: Uint8Array) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += STRING_BLOCK) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + STRING_BLOCK)));
  return btoa(parts.join(""));
}
async function captureImage(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || !file.size || file.size > IMAGE_LIMIT) return;
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap; bitmap.close();
  const { id } = await capture("begin", { format: file.type.split("/")[1], width, height, size: file.size }) as { id: string };
  try {
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
      await capture("chunk", { id, offset, data: encoded(bytes) });
    }
    await capture("finish", { id });
  } catch (error) { await capture("cancel", { id }).catch(() => {}); throw error; }
}
export function useClipboardCapture() {
  useEffect(() => {
    let imagesInFlight = 0;
    const paste = (event: ClipboardEvent) => {
      if (!event.isTrusted || !event.clipboardData) return;
      const file = Array.from(event.clipboardData.items).find((item) => /^image\/(png|jpeg|webp)$/.test(item.type))?.getAsFile();
      if (file) {
        if (imagesInFlight >= 2) return;
        imagesInFlight++;
        void captureImage(file).catch(() => {}).finally(() => { imagesInFlight--; });
        return;
      }
      const text = event.clipboardData.getData("text/plain");
      if (text && new TextEncoder().encode(text).length <= TEXT_LIMIT) void capture("text", { text }).catch(() => {});
    };
    document.addEventListener("paste", paste, true);
    return () => document.removeEventListener("paste", paste, true);
  }, []);
}
