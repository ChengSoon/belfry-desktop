import { describe, expect, it } from "vitest";
import { setEnabled } from "./mutations";
import { PluginRunCoordinator } from "./runCoordinator";

const registry = { storeSchemaVersion: 1 as const, revision: "9007199254740993", plugins: [{ currentManifest: { schemaVersion: 1 as const, id: "example.review", name: "Review", version: "1.0.0", author: "x", compatibility: { pluginApi: 1 as const, minAppVersion: "0.19.0" }, contributes: { templates: [] } }, enabled: false, installedAt: 1, updatedAt: 1, sourceFileName: null }] };

describe("plugin mutation coordinator", () => {
  it("does not change no-op revisions", () => { expect(setEnabled(registry, "example.review", { enabled: false, now: 2 }).outcome).toBe("no-change"); expect(registry.revision).toBe("9007199254740993"); });
  it("increments beyond JS safe integer", () => { expect(setEnabled(registry, "example.review", { enabled: true, now: 2 }).registry.revision).toBe("9007199254740994"); });
  it("revokes plugin runs and blocks retries during invalidation", () => { const c = new PluginRunCoordinator(); c.register({ runId: "a", pluginId: "example.review", revoked: false }); const aborted: string[] = []; c.invalidateAll((id) => aborted.push(id)); expect(aborted).toEqual(["a"]); expect(c.canRetry("a")).toBe(false); c.reconcile(); expect(c.isBlocked).toBe(false); });
});
