import { describe, expect, it } from "vitest";
import { settingsDraft, settingsPayload } from "./settingsValues";
import { shortcutMatches, shortcutConflict } from "./shortcuts";

describe("PI plugin settings", () => {
  it("validates incomplete numeric drafts without silently saving zero", () => {
    const fields = [{ key: "count", title: "数量", type: "number" as const }];
    for (const value of ["", "-", "1e", "0x10", Infinity, NaN]) {
      expect(() => settingsPayload(fields, { count: value })).toThrow("数量");
    }
    expect(settingsPayload(fields, { count: "1e-3" })).toEqual({ count: 0.001 });
    expect(settingsPayload(fields, { count: 0 })).toEqual({ count: 0 });
  });
  it("round-trips an untouched JSON value and preserves select value types", () => {
    const fields = [{ key: "data", title: "Data", type: "json" as const, value: { a: [true, 2] } },
      { key: "mode", title: "Mode", type: "select" as const, enum: [{ label: "two", value: 2 }], value: 2 }];
    expect(settingsPayload(fields, settingsDraft(fields))).toEqual({ data: { a: [true, 2] }, mode: 2 });
    expect(() => settingsPayload(fields, { data: "{broken", mode: 2 })).toThrow();
  });
  it("matches modifier aliases while rejecting app and duplicate shortcuts", () => {
    const event = { key: "y", code: "KeyY", ctrlKey: false, metaKey: true, altKey: false, shiftKey: true };
    expect(shortcutMatches("Mod+Shift+Y", event, true)).toBe(true);
    expect(shortcutMatches("Mod+Y", event, true)).toBe(false);
    expect(shortcutConflict(["Mod+K"], true)).toBe(true);
    expect(shortcutConflict(["Mod+Shift+Y", "Command+Shift+Y"], true)).toBe(true);
  });
});
