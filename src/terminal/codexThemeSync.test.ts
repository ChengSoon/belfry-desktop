import { describe, expect, it } from "vitest";
import { xtermTheme } from "../theme/xtermTheme";
import { CodexThemeSync } from "./codexThemeSync";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DARK_COMPOSER = "\x1b[48;2;39;39;40m";
const LIGHT_COMPOSER = "\x1b[48;2;240;240;240m";
const DEFAULT_BACKGROUND = "\x1b[49m";

describe("CodexThemeSync", () => {
  it("rewrites a dark-started composer for the light theme", () => {
    const sync = new CodexThemeSync(xtermTheme("dark"));
    sync.setTheme(xtermTheme("light"));

    expect(text(sync.rewrite(bytes(`before${DARK_COMPOSER}after`), true)))
      .toBe(`before${LIGHT_COMPOSER}after`);
  });

  it("rewrites the background inside a combined SGR sequence", () => {
    const sync = new CodexThemeSync(xtermTheme("dark"));
    sync.setTheme(xtermTheme("light"));
    const combined = "\x1b[1;38;2;237;237;239;48;2;39;39;40m";

    expect(text(sync.rewrite(bytes(combined), true)))
      .toBe("\x1b[1;38;2;237;237;239;48;2;240;240;240m");
  });

  it("supports colon-delimited true-color backgrounds", () => {
    const sync = new CodexThemeSync(xtermTheme("light"));
    sync.setTheme(xtermTheme("dark"));
    const combined = "\x1b[38:2::23:24:27;48:2::240:240:240m";

    expect(text(sync.rewrite(bytes(combined), true)))
      .toBe("\x1b[38:2::23:24:27;48:2::39:39:40m");
  });

  it("preserves a real startup redraw while replacing cleared composer rows", () => {
    const sync = new CodexThemeSync(xtermTheme("dark"));
    sync.setTheme(xtermTheme("light"));
    const redraw = [
      "\x1b[?2026h\x1b[1;1H\x1b[J",
      `\x1b[9;2H\x1b[0m${DARK_COMPOSER}\x1b[K`,
      `\x1b[10;27H\x1b[0m${DARK_COMPOSER}\x1b[K`,
      `\x1b[11;1H\x1b[39;48;2;39;39;40m `,
      "\x1b[39m\x1b[49m\x1b[?2026l",
    ].join("");

    const rewritten = text(sync.rewrite(bytes(redraw), true));
    expect(rewritten).not.toContain("48;2;39;39;40");
    expect(rewritten.match(/48;2;240;240;240/g)).toHaveLength(3);
    expect(rewritten).toContain("\x1b[?2026h\x1b[1;1H\x1b[J");
  });

  it("rewrites a light-started composer for the dark theme", () => {
    const sync = new CodexThemeSync(xtermTheme("light"));
    sync.setTheme(xtermTheme("dark"));

    expect(text(sync.rewrite(bytes(LIGHT_COMPOSER), true))).toBe(DARK_COMPOSER);
  });

  it("resets the known composer background when the terminal is transparent", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);

    expect(text(sync.rewrite(bytes(LIGHT_COMPOSER), true))).toBe(DEFAULT_BACKGROUND);
  });

  it("preserves combined foreground styles while resetting a transparent background", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);
    const combined = "\x1b[1;38;2;23;24;27;48;2;240;240;240m";

    expect(text(sync.rewrite(bytes(combined), true)))
      .toBe("\x1b[1;38;2;23;24;27;49m");
  });

  it("resets a colon-delimited composer background in transparent mode", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);
    const combined = "\x1b[38:2::23:24:27;48:2::240:240:240m";

    expect(text(sync.rewrite(bytes(combined), true)))
      .toBe("\x1b[38:2::23:24:27;49m");
  });

  it("restores the themed composer background when transparency is disabled", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);
    sync.setTheme(xtermTheme("light"), false);

    expect(text(sync.rewrite(bytes(LIGHT_COMPOSER), true))).toBe(LIGHT_COMPOSER);
  });

  it("resets a composer after a background image finishes loading", () => {
    const sync = new CodexThemeSync(xtermTheme("light"));
    sync.setTheme(xtermTheme("light"), true);

    expect(text(sync.rewrite(bytes(LIGHT_COMPOSER), true))).toBe(DEFAULT_BACKGROUND);
  });

  it("handles a startup probe racing with the first theme switch", () => {
    const sync = new CodexThemeSync(xtermTheme("dark"));
    sync.setTheme(xtermTheme("light"));
    sync.setTheme(xtermTheme("dark"));

    expect(text(sync.rewrite(bytes(LIGHT_COMPOSER), true))).toBe(DARK_COMPOSER);
  });

  it("reassembles a background sequence split across output events", () => {
    const sync = new CodexThemeSync(xtermTheme("dark"));
    sync.setTheme(xtermTheme("light"));
    const output = Array.from(bytes(DARK_COMPOSER), (byte) => sync.rewrite([byte])).flat();

    expect(text(output)).toBe(LIGHT_COMPOSER);
  });

  it("leaves unrelated true-color backgrounds untouched", () => {
    const sync = new CodexThemeSync(xtermTheme("dark"));
    sync.setTheme(xtermTheme("light"));
    const unrelated = "\x1b[48;2;39;39;41m";

    expect(text(sync.rewrite(bytes(unrelated), true))).toBe(unrelated);
  });

  it("resets nearby neutral backgrounds in transparent mode", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);
    const neutral = "\x1b[48;2;240;240;241m";

    expect(text(sync.rewrite(bytes(neutral), true))).toBe(DEFAULT_BACKGROUND);
  });

  it("resets white, gray, and black backgrounds while preserving colored backgrounds", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);
    const input = [
      "\x1b[47mwhite",
      "\x1b[48;5;250mgray",
      "\x1b[48;2;20;22;24mblack",
      "\x1b[48;2;59;91;219mblue",
    ].join("");

    expect(text(sync.rewrite(bytes(input), true))).toBe([
      "\x1b[49mwhite",
      "\x1b[49mgray",
      "\x1b[49mblack",
      "\x1b[48;2;59;91;219mblue",
    ].join(""));
  });

  it("resets colon-delimited neutral indexed backgrounds", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);

    expect(text(sync.rewrite(bytes("\x1b[48:5:255m"), true)))
      .toBe(DEFAULT_BACKGROUND);
  });

  it("turns off reverse video without dropping the remaining text styles", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);
    const reversed = "\x1b[1;38;2;59;91;219;7m";

    expect(text(sync.rewrite(bytes(reversed), true)))
      .toBe("\x1b[1;38;2;59;91;219;27m");
  });

  it("drops dim styling that WebGL renders as opaque cells over a transparent background", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);

    expect(text(sync.rewrite(bytes("before\x1b[2mafter"), true))).toBe("beforeafter");
  });

  it("removes dim from a combined sequence without disabling bold or colors", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);
    const styled = "\x1b[1;2;38;2;59;91;219m";

    expect(text(sync.rewrite(bytes(styled), true))).toBe("\x1b[1;38;2;59;91;219m");
  });

  it("does not mistake a true-color channel for reverse video", () => {
    const sync = new CodexThemeSync(xtermTheme("light"), true);
    const colored = "\x1b[38;2;7;91;219;48;2;59;7;219m";

    expect(text(sync.rewrite(bytes(colored), true))).toBe(colored);
  });

  it("flushes an incomplete candidate at end of stream", () => {
    const sync = new CodexThemeSync(xtermTheme("dark"));
    const partial = "\x1b[48;2;39";

    expect(sync.rewrite(bytes(partial))).toEqual([]);
    expect(text(sync.flush())).toBe(partial);
  });
});

function bytes(value: string) {
  return encoder.encode(value);
}

function text(value: ArrayLike<number>) {
  return decoder.decode(Uint8Array.from(value));
}
