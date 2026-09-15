import { expect, it, vi } from "vitest";
import { createProbeController } from "./probeController";
import type { RemoteReport } from "./contracts";

it("取消旧请求后忽略迟到目录，保留新请求结果", async () => {
  const callbacks: ((report: RemoteReport) => void)[] = [];
  let index = 0;
  const cancel = vi.fn(async () => undefined);
  const controller = createProbeController({ cancel, id: () => String(++index),
    probe: () => new Promise((resolve) => callbacks.push(resolve)) });
  const target = { host: "qa", user: null, port: null };
  const first = controller.run(target, true), second = controller.run(target, true);
  const report = { path: "/work", directories: [], truncated: false };
  callbacks[0](report); callbacks[1](report);
  expect(await first).toBeNull(); expect(await second).toEqual(report);
  expect(cancel).toHaveBeenCalledWith("1");
});
