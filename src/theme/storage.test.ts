import { describe, expect, it } from "vitest";
import { loadThemeMode, parseThemeMode } from "./storage";

describe("theme mode persistence", () => {
  it("keeps only the two supported modes", () => {
    expect(parseThemeMode("dark")).toBe("dark");
    expect(parseThemeMode("light")).toBe("light");
    expect(parseThemeMode("system")).toBeNull();
    expect(parseThemeMode(null)).toBeNull();
  });

  it("falls back to following the system when storage is unreadable", () => {
    const storage = {
      getItem() {
        throw new Error("storage disabled");
      },
    };
    expect(loadThemeMode(storage)).toBeNull();
  });
});
