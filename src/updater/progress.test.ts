import { describe, expect, it } from "vitest";
import { applyDownloadEvent, EMPTY_DOWNLOAD_PROGRESS, formatBytes } from "./progress";

describe("applyDownloadEvent", () => {
  it("根据总大小累计分片并计算百分比", () => {
    const started = applyDownloadEvent(EMPTY_DOWNLOAD_PROGRESS, {
      event: "Started",
      data: { contentLength: 1000 },
    });
    const first = applyDownloadEvent(started, { event: "Progress", data: { chunkLength: 250 } });
    const second = applyDownloadEvent(first, { event: "Progress", data: { chunkLength: 500 } });

    expect(second).toEqual({ downloadedBytes: 750, totalBytes: 1000, progress: 75 });
  });

  it("服务端不提供总大小时保留字节数但不伪造百分比", () => {
    const started = applyDownloadEvent(EMPTY_DOWNLOAD_PROGRESS, {
      event: "Started",
      data: {},
    });
    const progress = applyDownloadEvent(started, {
      event: "Progress",
      data: { chunkLength: 2048 },
    });

    expect(progress).toEqual({ downloadedBytes: 2048, totalBytes: null, progress: null });
  });

  it("异常超量分片最多显示 100%", () => {
    const progress = applyDownloadEvent(
      { downloadedBytes: 90, totalBytes: 100, progress: 90 },
      { event: "Progress", data: { chunkLength: 30 } },
    );

    expect(progress.progress).toBe(100);
  });
});

describe("formatBytes", () => {
  it("使用紧凑二进制单位", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
