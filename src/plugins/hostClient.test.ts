import { describe, expect, it } from "vitest";
import { PluginHostClient, decodeRegistry, pluginError } from "./hostClient";
import { staticCatalog } from "./staticCatalog";
import type { DirectoryRegistry } from "./hostContracts";
import { launchAlias } from "./launchAlias";
const state: DirectoryRegistry = { format: "belfry-directory-plugins-v1", storeSchemaVersion: 1, revision: "9007199254740993", plugins: [{
  manifest: { schemaVersion: 1, id: "example.review", name: "Review", version: "1.0.0", author: "Belfry", description: null, icon: null, compatibility: { pluginApi: 1, minAppVersion: "0.19.0", maxAppVersionExclusive: null }, permissions: ["commands", "skills", "settings"], activationEvents: ["onEnable"], contributes: {
    commands: [{ id: "review", title: "Review", text: "Review changes" }], skills: [{ id: "guide", title: "Guide", path: "SKILL.md" }], settings: [{ id: "style", title: "Style", description: "", default: "concise" }], harnesses: [],
  } }, enabled: true, error: null, source: "development", sourcePath: "/tmp/plugin", installedAt: 0, updatedAt: 0,
}] };
describe("directory plugin host", () => {
  it("rejects old registry and malformed contribution groups", () => {
    expect(() => decodeRegistry({ storeSchemaVersion: 1, revision: "0", plugins: [] })).toThrow();
    const broken = structuredClone(state); (broken.plugins[0].manifest.contributes as unknown as { skills: null }).skills = null;
    expect(() => decodeRegistry(broken)).toThrow();
  });
  it("preserves string revisions at the IPC boundary", async () => {
    const calls: unknown[] = []; const client = new PluginHostClient({ invoke: async (...args) => { calls.push(args); return state; } });
    await client.mutate("example.review", "disable", state.revision);
    expect(calls).toEqual([["plugins_mutate", { pluginId: "example.review", action: "disable", expectedRevision: "9007199254740993" }]]);
  });
  it("install sends only host preview token and revision", async () => {
    const calls: unknown[] = []; const client = new PluginHostClient({ invoke: async (...args) => { calls.push(args); return state; } });
    await client.install("preview", "0");
    expect(calls).toEqual([["plugins_install", { previewId: "preview", expectedRevision: "0" }]]);
  });
  it("withdraws every contribution on disable or failure", () => {
    const disabled = structuredClone(state); disabled.plugins[0].enabled = false;
    const failed = structuredClone(state); failed.plugins[0].error = "invalid source";
    for (const registry of [disabled, failed, null]) expect(Object.values(staticCatalog(registry)).flat()).toEqual([]);
    expect(Object.values(staticCatalog(state)).map((items) => items.length)).toEqual([1, 1, 1]);
  });
  it("accepts static registries with missing or empty legacy contribution fields", () => {
    const current = structuredClone(state);
    Reflect.deleteProperty(current.plugins[0].manifest.contributes, "harnesses");
    for (const value of [current, state]) {
      expect(decodeRegistry(value).plugins[0].enabled).toBe(true);
      expect(staticCatalog(value).commands).toHaveLength(1);
    }
  });
  it("never exposes contributions from a legacy Harness entry still marked enabled", () => {
    const permission = structuredClone(state);
    permission.plugins[0].manifest.permissions.push("harnesses");
    const contribution = structuredClone(state);
    contribution.plugins[0].manifest.contributes.harnesses = [{ id: "legacy", title: "Legacy", harnessPluginId: "old.package" }];
    for (const value of [permission, contribution]) {
      expect(Object.values(staticCatalog(value)).flat()).toEqual([]);
    }
  });
  it("preserves structured backend diagnostics", () => {
    expect(pluginError({ message: "权限改变" })).toBe("权限改变");
    expect(pluginError("锁被占用")).toBe("锁被占用");
  });
});

describe("retired Harness alias", () => {
  it("rejects old callers without reading a host or launching a session", async () => {
    const calls: string[] = [];
    await expect(launchAlias({ key: "example.review:legacy",
      loadDirectory: async () => { calls.push("directory"); return state; },
      loadHarnesses: async () => { calls.push("harness"); return { plugins: [] }; },
      launch: () => { calls.push("launch"); },
    })).rejects.toThrow("Harness 功能已移除");
    expect(calls).toEqual([]);
  });
});
