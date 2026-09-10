import { describe, expect, it } from "vitest";
import { pluginAppearance } from "./appearance";

describe("pluginAppearance", () => {
  it("preserves the raw preference and passes the validated full theme to panels", () => {
    const css = ":root { --ds-bg-primary: #102030; }";
    const appearance = pluginAppearance({ mode: "dark", pinned: true }, "mine.theme:night", { id: "night", base: "dark", css });
    expect(appearance).toEqual({ theme: "plugin:mine.theme:night", base: "dark", locale: "zh-CN", pluginTheme: { id: "mine.theme:night", base: "dark", css } });
  });
  it("keeps system preference and omits inactive or unsafe theme CSS", () => {
    expect(pluginAppearance({ mode: "light", pinned: false }, "").theme).toBe("system");
    expect(pluginAppearance({ mode: "light", pinned: true }, "mine.theme:night", { id: "night", base: "dark", css: ":root{}" }).pluginTheme).toBeNull();
    expect(pluginAppearance({ mode: "dark", pinned: true }, "mine.theme:night", { id: "night", base: "dark", css: "@import 'https://example.invalid/x.css';" }).pluginTheme).toBeNull();
  });
});
