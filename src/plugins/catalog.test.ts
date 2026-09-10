import { describe, expect, it } from "vitest";
import { searchQuickOpen } from "../quickopen/model";
import { buildPluginCatalog } from "./catalog";
import { directoryFixture } from "./testing/fixtures";

describe("private plugin catalog adapter", () => {
  it("separates identical names and local IDs by plugin namespace", () => {
    const first = directoryFixture();
    const second = { ...directoryFixture(), pluginId: "other.review-kit" };
    const catalog = buildPluginCatalog([first, second]);
    expect([
      "plugin:example.review-kit:action:open-review",
      "plugin:other.review-kit:action:open-review",
    ]).toEqual(catalog.actions.map((action) => action.id));
    expect("plugin:example.review-kit:template:review").toEqual(catalog.actions[0].value);
    expect("代码审查助手 · 1.0.0").toEqual(catalog.actions[0].subtitle);
    expect(2).toEqual(searchQuickOpen(catalog.actions, "代码审查助手 review").length);
    expect(false).toEqual(catalog.actions.some((action) => action.id.startsWith("action:")));
  });

  it("omits all contributions of unavailable sources", () => {
    expect({ actions: [], templates: [] }).toEqual(buildPluginCatalog([
      { ...directoryFixture(), available: false },
    ]));
  });

  it("keeps steps and action keywords independent of the caller's data", () => {
    const source = directoryFixture();
    const catalog = buildPluginCatalog([source]);
    source.templates[0].steps[0].text = "changed";
    source.actions[0].keywords.push("changed");
    expect("审查 {{scope}}\r\n保留原文").toEqual(catalog.templates[0].steps[0].text);
    expect(false).toEqual(catalog.actions[0].keywords?.includes("changed"));
  });
});

describe("private catalog preconditions", () => {
  it("rejects ambiguous or dangling projections instead of exposing a partial catalog", () => {
    const duplicate = directoryFixture();
    duplicate.templates.push({ ...duplicate.templates[0] });
    expect(() => buildPluginCatalog([duplicate])).toThrow();
    const dangling = directoryFixture();
    dangling.actions[0].templateId = "missing";
    expect(() => buildPluginCatalog([dangling])).toThrow();
    expect(() => buildPluginCatalog([directoryFixture(), directoryFixture()])).toThrow();
    const actions = directoryFixture();
    actions.actions.push({ ...actions.actions[0] });
    expect(() => buildPluginCatalog([actions])).toThrow();
  });

  it("never interprets display text as markup or host commands", () => {
    const source = directoryFixture();
    source.actions[0].title = "<img src=x onerror=alert(1)>";
    const { actions } = buildPluginCatalog([source]);
    expect(source.actions[0].title).toEqual(actions[0].title);
    expect("action").toEqual(actions[0].kind);
    expect("plugin:example.review-kit:template:review").toEqual(actions[0].value);
  });
});
