import { describe, expect, it } from "vitest";
import { themeTokens } from "./pluginTheme";

describe("PI plugin theme colors", () => {
  it("maps PI colors to Belfry tokens and keeps custom host colors", () => {
    expect(themeTokens(":root { --ds-bg-primary: #181a20; --ds-accent: rgb(1 2 3); --text: white; }"))
      .toEqual({ "--canvas": "#181a20", "--accent": "rgb(1 2 3)", "--text": "white" });
  });
  it("ignores selectors, unrelated properties and values that load or execute content", () => {
    expect(themeTokens(`/* --text: red; */ body { display: none; --canvas: url(https://example.invalid); }
      :root { --unknown: red; --text: expression(alert(1)); --accent: #abc; --border: var(--external); }`))
      .toEqual({ "--accent": "#abc" });
    expect(() => themeTokens("x".repeat(65_537))).toThrow("插件主题过大");
  });
});
