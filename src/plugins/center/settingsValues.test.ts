import { describe, expect, it } from "vitest";
import { settingsDraft, settingsPayload } from "./settingsValues";
import { shortcutMatches, shortcutConflict } from "./shortcuts";

describe("PI plugin settings", () => {
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
