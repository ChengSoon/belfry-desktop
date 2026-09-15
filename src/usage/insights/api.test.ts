import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { cancelUsageAnalytics, fetchUsageAnalytics } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

it("查询与后台取消使用同一个请求 ID，保留原查询字段", async () => {
  const query = { windowDays: 30, projectRoot: null };
  await fetchUsageAnalytics(query, "request-id");
  await cancelUsageAnalytics("request-id");
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["usage_analytics", { query, requestId: "request-id" }],
    ["usage_cancel_analytics", { requestId: "request-id" }],
  ]);
});
