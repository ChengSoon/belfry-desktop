import { describe, expect, it } from "vitest";
import { confirmText, isRevisionConflict, pluginStatus } from "./RegistrySection";
const plugin = { pluginId: "x", version: "1.0.0", manifestDigest: "d", harnessApi: 1, minAppVersion: "0.19.0", trusted: true, enabled: true, source: "s", tools: [], capabilities: ["project.read"] };
describe("RegistrySection behavior", () => {
  it("derives trust compatibility and enabled status", () => { expect(pluginStatus(plugin)).toEqual({ trusted: true, compatible: true, enabled: true }); expect(pluginStatus({ ...plugin, harnessApi: 2 }).compatible).toBe(false); expect(pluginStatus({ ...plugin, minAppVersion: "0.20.0" }).compatible).toBe(false); });
  it("recognizes only stable revision conflicts", () => { expect(isRevisionConflict({ code: "REVISION_CONFLICT", message: "/private/path" })).toBe(true); expect(isRevisionConflict(new Error("conflict"))).toBe(false); });
  it("uses explicit destructive confirmations", () => { expect(confirmText("disable", "x")).toContain("新会话"); expect(confirmText("uninstall", "x")).toContain("历史快照"); });
});
