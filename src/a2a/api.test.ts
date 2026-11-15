import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from "vitest";
import { isProbeCancelled, listConnections, listLocalAgents, localTaskSnapshot, probeConnection, removeConnection, saveConnection } from "./api";
import type { ConnectionDraft, Discovery } from "./contracts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const native = vi.mocked(invoke);
const draft: ConnectionDraft = { name: "Fixture", cardUrl: "http://127.0.0.1/card", auth: { kind: "none", credential: { action: "clear" } } };
const discovery: Discovery = { card: { name: "Fixture" }, interfaces: [], selectedInterface: null, issue: null };
beforeEach(() => { native.mockReset(); });

it("uses the published project-scoped native CRUD arguments", async () => {
  native.mockResolvedValue(null);
  await listConnections("/project-a"); await saveConnection("/project-a", draft); await removeConnection("/project-a", "connection-a"); await listLocalAgents("/project-a"); await localTaskSnapshot("/project-a");
  expect(native.mock.calls).toEqual([
    ["a2a_list_connections", { rootPath: "/project-a" }], ["a2a_save_connection", { rootPath: "/project-a", draft }],
    ["a2a_remove_connection", { rootPath: "/project-a", connectionId: "connection-a" }],
    ["a2a_list_local_agents", { rootPath: "/project-a" }],
    ["a2a_local_task_snapshot", { rootPath: "/project-a" }],
  ]);
});

it("cancels the original project and request, settles locally, and ignores the late native result", async () => {
  let release!: (value: Discovery) => void;
  native.mockImplementation(command => command === "a2a_probe_connection" ? new Promise(resolve => { release = resolve as (value: Discovery) => void; }) : Promise.resolve(true));
  const controller = new AbortController(), checking = probeConnection("/project-a", draft, controller.signal);
  const request = native.mock.calls[0][1] as { requestId: string };
  expect(request.requestId).toMatch(/^[a-f0-9-]{36}$/);
  controller.abort();
  const failure = await checking.catch(error => error);
  expect(isProbeCancelled(failure)).toBe(true);
  expect(native.mock.calls[1]).toEqual(["a2a_cancel_request", { rootPath: "/project-a", requestId: request.requestId }]);
  release(discovery);
  await Promise.resolve();
  expect(native).toHaveBeenCalledTimes(2);
});

it("does not start a native probe when already cancelled and removes cancellation after success", async () => {
  const cancelled = new AbortController(); cancelled.abort();
  await expect(probeConnection("/project-a", draft, cancelled.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(native).not.toHaveBeenCalled();
  native.mockResolvedValue(discovery);
  const controller = new AbortController();
  await expect(probeConnection("/project-a", draft, controller.signal)).resolves.toBe(discovery);
  controller.abort();
  expect(native).toHaveBeenCalledTimes(1);
});

it("preserves native errors without issuing a second probe or retrying", async () => {
  const failure = { code: "A2A_HTTP_ERROR", message: "Unauthorized", details: { httpStatus: 401 } };
  native.mockRejectedValue(failure);
  const actual = await probeConnection("/project-a", draft).catch(error => error);
  expect(actual).toEqual(failure);
  expect(native).toHaveBeenCalledTimes(1);
});
