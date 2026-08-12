import type { DownloadEvent } from "@tauri-apps/plugin-updater";

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  progress: number | null;
}

export const EMPTY_DOWNLOAD_PROGRESS: DownloadProgress = {
  downloadedBytes: 0,
  totalBytes: null,
  progress: null,
};

export function applyDownloadEvent(
  current: DownloadProgress,
  event: DownloadEvent,
): DownloadProgress {
  if (event.event === "Started") {
    const totalBytes = event.data.contentLength ?? null;
    return { downloadedBytes: 0, totalBytes, progress: totalBytes ? 0 : null };
  }
  if (event.event === "Finished") {
    return { ...current, progress: 100 };
  }
  const downloadedBytes = current.downloadedBytes + event.data.chunkLength;
  return {
    downloadedBytes,
    totalBytes: current.totalBytes,
    progress: calculateProgress(downloadedBytes, current.totalBytes),
  };
}

function calculateProgress(downloadedBytes: number, totalBytes: number | null) {
  if (!totalBytes || totalBytes <= 0) return null;
  return Math.min((downloadedBytes / totalBytes) * 100, 100);
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 100 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}
