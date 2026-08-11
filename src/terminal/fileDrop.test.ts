import { describe, expect, it } from "vitest";
import type { TerminalSession } from "./contracts";
import { formatDroppedPaths, pointInsideRect } from "./fileDrop";

function session(platform: TerminalSession["platform"], shell: string): TerminalSession {
  return {
    id: "test",
    platform,
    shell,
    cwd: ".",
    cols: 80,
    rows: 24,
    status: "running",
    exitCode: null,
  };
}

describe("dropped terminal files", () => {
  it("quotes PowerShell paths and keeps multiple files as separate arguments", () => {
    expect(formatDroppedPaths(
      ["C:\\Work Files\\one.txt", "C:\\it's\\two.txt"],
      session("windows", "powershell.exe"),
    )).toBe("'C:\\Work Files\\one.txt' 'C:\\it''s\\two.txt' ");
  });

  it("uses cmd-compatible quotes for the cmd fallback", () => {
    expect(formatDroppedPaths(
      ["C:\\Work Files\\one.txt"],
      session("windows", "C:\\Windows\\System32\\cmd.exe"),
    )).toBe('"C:\\Work Files\\one.txt" ');
  });

  it("escapes apostrophes for POSIX shells", () => {
    expect(formatDroppedPaths(
      ["/tmp/a file.txt", "/tmp/it's.txt"],
      session("macos", "zsh"),
    )).toBe("'/tmp/a file.txt' '/tmp/it'\\''s.txt' ");
  });

  it("ignores an empty native drop payload", () => {
    expect(formatDroppedPaths([], session("macos", "zsh"))).toBe("");
  });

  it("matches only points inside the terminal bounds", () => {
    const rect = { left: 10, right: 110, top: 20, bottom: 120 };
    expect(pointInsideRect({ x: 10, y: 80 }, rect)).toBe(true);
    expect(pointInsideRect({ x: 111, y: 80 }, rect)).toBe(false);
  });
});
