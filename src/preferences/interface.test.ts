import { describe, expect, it } from "vitest";
import { applyInterface, DEFAULT_INTERFACE, parseInterface } from "./interface";

describe("interface preferences", () => {
  it("parses only boolean flags and falls back on malformed storage", () => {
    expect(parseInterface(null)).toEqual(DEFAULT_INTERFACE);
    expect(parseInterface("not json")).toEqual(DEFAULT_INTERFACE);
    expect(parseInterface('{"reduceMotion":"yes","compactSidebar":true}')).toEqual({ reduceMotion: false, compactSidebar: true });
  });
  it("reflects preferences as data attributes and removes them when off", () => {
    const root = { dataset: {} as DOMStringMap };
    applyInterface({ reduceMotion: true, compactSidebar: true }, root);
    expect(root.dataset).toEqual({ motion: "reduced", sidebarDensity: "compact" });
    applyInterface(DEFAULT_INTERFACE, root);
    expect(root.dataset).toEqual({});
  });
});
