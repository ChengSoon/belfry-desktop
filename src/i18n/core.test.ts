import { describe, expect, it, vi } from "vitest";
import { flattenCatalog, resolveLocale, translate, type Catalogs } from "./core";
import { createLocaleStore } from "./store";

const catalogs: Catalogs = {
  "zh-CN": { greeting: "你好，{{name}}", pending: { other: "{{count}} 项" }, fallback: "中文兜底" },
  en: { greeting: "Hello, {{name}}", pending: { one: "{{count}} item", other: "{{count}} items" } },
};
describe("translation", () => {
  it("interpolates values as text and selects locale plural forms including zero", () => {
    expect(translate(catalogs, "en", "greeting", { name: "<script>" })).toBe("Hello, <script>");
    expect(translate(catalogs, "en", "pending", { count: 0 })).toBe("0 items");
    expect(translate(catalogs, "en", "pending", { count: 1 })).toBe("1 item");
    expect(translate(catalogs, "en", "pending", { count: 2 })).toBe("2 items");
    expect(translate(catalogs, "zh-CN", "pending", { count: 1 })).toBe("1 项");
  });
  it("falls back to Chinese and reports the missing locale key", () => {
    const missing = vi.fn();
    expect(translate(catalogs, "en", "fallback", {}, missing)).toBe("中文兜底");
    expect(missing).toHaveBeenCalledWith("fallback", "en");
    expect(translate(catalogs, "en", "unknown", { defaultValue: "Unavailable" })).toBe("Unavailable");
    expect(translate(catalogs, "en", "unknown")).toBe("unknown");
  });
  it("supports nested keys, literal dotted permission names and plural entries", () => {
    expect(flattenCatalog({ permissions: { "fs.read": "Read files" }, count: { one: "One", other: "Many" } }, "plugins"))
      .toEqual({ "plugins.permissions.fs.read": "Read files", "plugins.count": { one: "One", other: "Many" } });
  });
});
describe("language preference", () => {
  it("resolves Chinese system locales and uses English for other languages", () => {
    expect(resolveLocale("system", ["zh-TW"])).toBe("zh-CN");
    expect(resolveLocale("system", ["ja-JP", "zh-CN"])).toBe("en");
    expect(resolveLocale("en", ["zh-CN"])).toBe("en");
  });
  it("persists the preference and applies system changes only while following the system", () => {
    let stored: string | null = null, languages = ["en-US"];
    const apply = vi.fn(), listener = vi.fn();
    const store = createLocaleStore({ read: () => stored, write: value => { stored = value; }, languages: () => languages, apply });
    const initial = store.getSnapshot();
    expect(initial).toEqual({ preference: "system", locale: "en" });
    expect(store.getSnapshot()).toBe(initial);
    store.subscribe(listener); store.setPreference("zh-CN");
    expect(stored).toBe("zh-CN"); expect(apply).toHaveBeenLastCalledWith("zh-CN");
    languages = ["en-GB"]; store.systemChanged();
    expect(listener).toHaveBeenCalledTimes(1);
    store.setPreference("system"); expect(store.getSnapshot().locale).toBe("en");
    languages = ["zh-HK"]; store.systemChanged();
    expect(store.getSnapshot()).toEqual({ preference: "system", locale: "zh-CN" });
    store.storageChanged("en"); expect(store.getSnapshot().locale).toBe("en");
    expect(stored).toBe("system");
  });
  it("keeps switching usable when preference storage is unavailable", () => {
    const store = createLocaleStore({ read: () => { throw Error("blocked"); }, write: () => { throw Error("blocked"); }, languages: () => ["zh-CN"] });
    store.setPreference("en"); expect(store.getSnapshot().locale).toBe("en");
  });
});
