import { describe, expect, it } from "vitest";
import { PluginHostClient } from "./hostClient";
import { parseSettingDraft } from "./settingDraft";
import { pluginCommandItems } from "./runtimeCatalog";
import { emptyRuntimeCatalog } from "./runtimeContracts";

describe("PI runtime UI boundary", () => {
  it("runs a callback by plugin and command ID, without sending pasted command text", async () => {
    const calls: unknown[] = [];
    const client = new PluginHostClient({ invoke: async (...args) => { calls.push(args); return { done: true }; } });
    expect(await client.runCommand("demo.hello", "hello.open")).toEqual({ done: true });
    expect(calls).toEqual([["plugins_runtime", { method: "command", params: { pluginId: "demo.hello", commandId: "hello.open" } }]]);
  });
  it("preserves typed setting values through the host boundary", async () => {
    const calls: unknown[] = [];
    const client = new PluginHostClient({ invoke: async (...args) => { calls.push(args); return { count: 3, enabled: false }; } });
    await client.setSettings("demo.hello", { count: 3, enabled: false });
    expect(calls).toEqual([["plugins_runtime", { method: "settings.set", params: { pluginId: "demo.hello", values: { count: 3, enabled: false } } }]]);
  });
  it("uses only live runtime registrations in Quick Open", () => {
    const runtime = { ...emptyRuntimeCatalog, commands: [{ pluginId: "demo.hello", pluginName: "Hello", id: "hello.open", title: "打开 Hello", keywords: ["demo"] }] };
    expect(pluginCommandItems(runtime)[0]).toMatchObject({ title: "打开 Hello", subtitle: "Hello · 插件命令", value: "demo.hello:hello.open" });
    expect(pluginCommandItems(emptyRuntimeCatalog)).toEqual([]);
  });
  it("validates numeric, JSON and typed select drafts without turning empty input into zero", () => {
    expect(parseSettingDraft({ key: "n", type: "number" }, "3.5")).toBe(3.5);
    expect(() => parseSettingDraft({ key: "n", type: "number" }, "")).toThrow();
    expect(() => parseSettingDraft({ key: "n", type: "number" }, "Infinity")).toThrow();
    expect(parseSettingDraft({ key: "j", type: "json" }, '{"ok":true}')).toEqual({ ok: true });
    expect(parseSettingDraft({ key: "s", type: "select", enum: [{ label: "关闭", value: false }] }, "0")).toBe(false);
  });
});
