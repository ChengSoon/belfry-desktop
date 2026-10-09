import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { filterSettingsNavigation, normalizeSettingsSection, SettingsNavigation, settingsGroups, settingsSectionKeys } from "./SettingsPanel";

describe("SettingsPanel navigation", () => {
  it("exposes the directory plugin center without the retired Harness section", () => {
    expect(settingsSectionKeys).toContain("plugins");
    expect(settingsSectionKeys).toContain("shortcuts");
    expect(settingsSectionKeys).not.toContain("harness");
  });

  it("safely falls back unknown legacy routes", () => {
    expect(normalizeSettingsSection("plugins")).toBe("plugins");
    expect(normalizeSettingsSection("shortcuts")).toBe("shortcuts");
    expect(normalizeSettingsSection("removed-plugin-route")).toBe("appearance");
    expect(normalizeSettingsSection("harness")).toBe("appearance");
  });
});

describe("Graphite settings directory", () => {
  it("groups all existing section keys by purpose without dropping controls or deep links", () => {
    const groups = filterSettingsNavigation("");
    expect(groups.map((group) => group.label)).toEqual(settingsGroups);
    expect(groups.flatMap((group) => group.sections.map((section) => section.key))).toEqual(settingsSectionKeys);
    expect(groups[0].sections.map((section) => section.key)).toEqual(["appearance", "shortcuts"]);
    expect(groups[1].sections.map((section) => section.key)).toEqual(["provider", "project-provider", "agent-hooks"]);
    expect(settingsSectionKeys).toHaveLength(9);
    for (const key of settingsSectionKeys) expect(normalizeSettingsSection(key)).toBe(key);
  });

  it("searches labels, purpose and control keywords case-insensitively", () => {
    const keys = (query: string) => filterSettingsNavigation(query).flatMap((group) => group.sections.map((section) => section.key));
    expect(keys("  FONT ")).toEqual(["appearance"]);
    expect(keys("壁纸")).toEqual(["appearance"]);
    expect(keys("后台会话")).toEqual(["agent-hooks"]);
    expect(keys("provider API")).toEqual(["provider", "project-provider"]);
    expect(keys("帮助与诊断")).toEqual(["environment", "about"]);
    expect(keys("no-such-section")).toEqual([]);
  });

  it("renders current-page semantics, guarded navigation and an explicit no-results state", () => {
    const props = { active: "provider" as const, guarded: true, query: "", onQuery: () => {}, onSelect: () => {} };
    const html = renderToStaticMarkup(createElement(SettingsNavigation, props));
    expect(html.match(/role="group"/g)).toHaveLength(5);
    expect(html).toContain('aria-current="page"');
    expect(html.match(/disabled=""/g)).toHaveLength(8);
    expect(html).toContain("保存或取消后离开");
    const empty = renderToStaticMarkup(createElement(SettingsNavigation, { ...props, query: "no-such-section" }));
    expect(empty).toContain("没有匹配的设置分类");
    expect(empty).toContain("当前内容保持打开");
    expect(empty).toContain("保存或取消后离开");
    expect(empty).not.toContain("<button");
  });
});
