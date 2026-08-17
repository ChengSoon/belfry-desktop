import { describe, expect, it } from "vitest";
import {
  appShortcutChord,
  formatShortcutChord,
  resolveAppShortcut,
  shortcutPlatform,
  systemShortcutChord,
} from "./resolveShortcut";

const baseEvent = {
  altKey: false,
  code: "KeyA",
  ctrlKey: false,
  isComposing: false,
  metaKey: false,
  repeat: false,
  shiftKey: false,
};

describe("resolveAppShortcut", () => {
  it("resolves the expanded macOS shortcuts", () => {
    expect(resolveAppShortcut({ ...baseEvent, code: "KeyB", metaKey: true }, "macos"))
      .toEqual({ kind: "toggle-sidebar" });
    expect(resolveAppShortcut({ ...baseEvent, code: "KeyT", metaKey: true }, "macos"))
      .toEqual({ kind: "new-shell" });
    expect(resolveAppShortcut({ ...baseEvent, code: "Comma", metaKey: true }, "macos"))
      .toEqual({ kind: "open-settings" });
    expect(resolveAppShortcut({ ...baseEvent, code: "Digit4", metaKey: true }, "macos"))
      .toEqual({ kind: "activate-session", index: 3 });
  });

  it("reserves shifted H for history on macOS", () => {
    expect(resolveAppShortcut({ ...baseEvent, code: "KeyH", metaKey: true }, "macos")).toBeNull();
    expect(resolveAppShortcut({ ...baseEvent, code: "KeyH", metaKey: true, shiftKey: true }, "macos"))
      .toEqual({ kind: "toggle-history" });
  });

  it("requires Ctrl+Shift on Windows and Linux so Agent Ctrl keys pass through", () => {
    expect(resolveAppShortcut({ ...baseEvent, code: "KeyB", ctrlKey: true }, "control")).toBeNull();
    expect(resolveAppShortcut({ ...baseEvent, code: "KeyB", ctrlKey: true, shiftKey: true }, "control"))
      .toEqual({ kind: "toggle-sidebar" });
    expect(resolveAppShortcut({ ...baseEvent, code: "KeyU", ctrlKey: true, shiftKey: true }, "control"))
      .toEqual({ kind: "toggle-usage" });
    expect(resolveAppShortcut({ ...baseEvent, code: "Digit9", ctrlKey: true, shiftKey: true }, "control"))
      .toEqual({ kind: "activate-session", index: 8 });
  });

  it("uses the physical slash key for both slash and shifted question mark", () => {
    expect(resolveAppShortcut({ ...baseEvent, code: "Slash", metaKey: true }, "macos"))
      .toEqual({ kind: "toggle-shortcuts" });
    expect(resolveAppShortcut({ ...baseEvent, code: "Slash", metaKey: true, shiftKey: true }, "macos"))
      .toEqual({ kind: "toggle-shortcuts" });
  });

  it("ignores composing, repeated, AltGr-like, and unrelated input", () => {
    const control = { ...baseEvent, code: "KeyB", ctrlKey: true, shiftKey: true };
    expect(resolveAppShortcut({ ...control, isComposing: true }, "control")).toBeNull();
    expect(resolveAppShortcut({ ...control, repeat: true }, "control")).toBeNull();
    expect(resolveAppShortcut({ ...control, altKey: true }, "control")).toBeNull();
    expect(resolveAppShortcut({ ...control, code: "KeyA" }, "control")).toBeNull();
  });
});

describe("shortcut labels", () => {
  it("uses platform-native app and terminal chords", () => {
    expect(shortcutPlatform("macos")).toBe("macos");
    expect(shortcutPlatform("windows")).toBe("control");
    expect(appShortcutChord("macos", "H", true)).toEqual(["⌘", "Shift", "H"]);
    expect(appShortcutChord("control", "B")).toEqual(["Ctrl", "Shift", "B"]);
    expect(systemShortcutChord("control", "C")).toEqual(["Ctrl", "C"]);
    expect(formatShortcutChord(["Ctrl", "Shift", "/"])).toBe("Ctrl+Shift+/");
  });
});
