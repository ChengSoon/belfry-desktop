import { describe, expect, it } from "vitest";
import { Unicode11Provider, unicodeStringWidth } from "./unicode";

describe("Unicode 11 terminal widths", () => {
  const provider = new Unicode11Provider();

  it("keeps ASCII at one cell and CJK at two cells", () => {
    expect(provider.wcwidth("A".codePointAt(0)!)).toBe(1);
    expect(provider.wcwidth("你".codePointAt(0)!)).toBe(2);
    expect(unicodeStringWidth("A你B", provider)).toBe(4);
  });

  it("renders emoji as a two-cell grapheme", () => {
    expect(provider.wcwidth("😀".codePointAt(0)!)).toBe(2);
    expect(unicodeStringWidth("😀", provider)).toBe(2);
  });

  it("does not allocate a new cell for combining marks", () => {
    expect(unicodeStringWidth("e\u0301", provider)).toBe(1);
    expect(unicodeStringWidth("你\ufe0f", provider)).toBe(2);
  });

  it("keeps a ZWJ emoji sequence at one emoji width", () => {
    expect(unicodeStringWidth("👩‍💻", provider)).toBe(2);
    expect(unicodeStringWidth("🏳️‍🌈", provider)).toBe(2);
  });

  it("pairs regional indicators into one flag width", () => {
    expect(unicodeStringWidth("🇨🇳", provider)).toBe(2);
    expect(unicodeStringWidth("🇨🇳🇺", provider)).toBe(4);
  });
});
