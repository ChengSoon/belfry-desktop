import { describe, expect, it, vi } from "vitest";
import { HarnessRegistryClient, type HarnessPlugin } from "./registryClient";

const plugin: HarnessPlugin = {
  pluginId: "example.harness", version: "1.0.0", manifestDigest: "digest", harnessApi: 1,
  minAppVersion: "0.19.0", trusted: true, enabled: true, source: "fixture",
  tools: ["project.read"], capabilities: ["project.read"],
};
const snapshot = { sessionId: "s", agentId: "a", plugin, workerId: "w", projectRoot: "/project", grants: [], cancelled: false, resumable: true };
const state = { schemaVersion: 1, revision: "2", plugins: [plugin], history: [], sessions: [snapshot] };

describe("HarnessRegistryClient", () => {
  it("maps registry mutations to registered Tauri commands", async () => {
    const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => state);
    const client = new HarnessRegistryClient({ invoke });
    await client.list();
    await client.install("1", plugin);
    await client.update("2", plugin);
    await client.disable("3", plugin.pluginId);
    await client.uninstall("4", plugin.pluginId);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "harness_registry_list", "harness_registry_install", "harness_registry_update",
      "harness_registry_disable", "harness_registry_uninstall",
    ]);
    expect(invoke).toHaveBeenLastCalledWith("harness_registry_uninstall", { expectedRevision: "4", pluginId: plugin.pluginId });
  });

  it("creates immutable session snapshots then updates host grants", async () => {
    const invoke = vi.fn(async (command: string) => command === "harness_session_authorize" ? { ...snapshot, grants: ["project.read"] } : snapshot);
    const client = new HarnessRegistryClient({ invoke });
    expect(await client.snapshot({ sessionId: "s", agentId: "a", pluginId: plugin.pluginId, workerId: "w", projectRoot: "/project" })).toEqual(snapshot);
    expect((await client.authorize("s", ["project.read"])).grants).toEqual(["project.read"]);
    expect(invoke).toHaveBeenNthCalledWith(2, "harness_session_authorize", { sessionId: "s", grants: ["project.read"] });
  });

  it("rejects malformed host state instead of trusting IPC", async () => {
    const client = new HarnessRegistryClient({ invoke: vi.fn(async () => ({ revision: 1 })) });
    await expect(client.list()).rejects.toThrow("Invalid Harness registry state");
  });

  it("starts only by session ID through the narrow host command", async () => {
    const invoke = vi.fn(async () => "worker-1");
    expect(await new HarnessRegistryClient({ invoke }).startSessionWorker("session-1")).toBe("worker-1");
    expect(invoke).toHaveBeenCalledWith("harness_session_worker_start", { sessionId: "session-1" });
  });

  it("previews, commits, and cancels a host-owned local install", async () => {
    const preview = { previewId: "p", expectedRevision: "2", pluginId: "local.example", version: "1.0.0", capabilities: ["project.read"], workerDigest: "abc", trust: "local-user-approved/integrity-checked", signed: false };
    const invoke = vi.fn(async (command: string) => command.endsWith("preview") ? preview : command.endsWith("commit") ? state : undefined);
    const client = new HarnessRegistryClient({ invoke });
    expect(await client.previewInstall("/picked/manifest.json", "/picked/worker.mjs")).toEqual(preview);
    await client.commitInstall("p"); await client.cancelInstall("other");
    expect(invoke.mock.calls).toEqual([
      ["harness_registry_install_preview", { manifestPath: "/picked/manifest.json", workerPath: "/picked/worker.mjs" }],
      ["harness_registry_install_commit", { previewId: "p" }],
      ["harness_registry_install_cancel", { previewId: "other" }],
    ]);
  });
});
