import { describe, expect, it } from "vitest";
import { normalizeSettingsSection, settingsSectionKeys } from "./SettingsPanel";

describe("SettingsPanel navigation", () => {
  it("exposes the directory plugin center without the retired Harness section", () => {
    expect(settingsSectionKeys).toContain("plugins");
    expect(settingsSectionKeys).not.toContain("harness");
  });

  it("safely falls back unknown legacy routes", () => {
    expect(normalizeSettingsSection("plugins")).toBe("plugins");
    expect(normalizeSettingsSection("removed-plugin-route")).toBe("appearance");
    expect(normalizeSettingsSection("harness")).toBe("appearance");
  });
});
