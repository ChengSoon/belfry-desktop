import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_FONT_STACK,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_UI_FONT_STACK,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  importedFontFamily,
} from "./contracts";
import { typographySizeTokens } from "./sizing";
import {
  loadTypography,
  parseTypography,
  resolveTypographyFontFamily,
  typographyFontStacks,
} from "./storage";

const LEGACY_FONT = {
  fileName: "custom-font.woff2",
  displayName: "Maple Mono",
  mime: "font/woff2",
  byteSize: 2048,
};

const SECOND_FONT = {
  fileName: "imported-00000000000000000000000000.otf",
  displayName: "Iosevka",
  mime: "font/otf",
  byteSize: 4096,
};

describe("typography config persistence", () => {
  it("round-trips a complete config", () => {
    const config = {
      fontFamily: "Maple Mono",
      fontSize: 18,
      activeImportedFont: null,
      importedFonts: [],
    };
    expect(parseTypography(JSON.stringify(config))).toEqual(config);
  });

  it("falls back to defaults for unreadable values", () => {
    expect(parseTypography(null)).toEqual(DEFAULT_TYPOGRAPHY);
    expect(parseTypography("{ not json")).toEqual(DEFAULT_TYPOGRAPHY);
    expect(parseTypography("[]")).toEqual(DEFAULT_TYPOGRAPHY);
  });

  it("repairs fields independently and clamps the font size", () => {
    const low = parseTypography('{"fontFamily": 42, "fontSize": 2}');
    expect(low.fontFamily).toBe(DEFAULT_TYPOGRAPHY.fontFamily);
    expect(low.fontSize).toBe(MIN_FONT_SIZE);

    const high = parseTypography('{"fontFamily": "  Iosevka  ", "fontSize": 99}');
    expect(high.fontFamily).toBe("Iosevka");
    expect(high.fontSize).toBe(MAX_FONT_SIZE);
  });

  it("rejects non-finite and non-number font sizes", () => {
    expect(parseTypography('{"fontSize": "18"}').fontSize)
      .toBe(DEFAULT_TYPOGRAPHY.fontSize);
    expect(parseTypography('{"fontSize": null}').fontSize)
      .toBe(DEFAULT_TYPOGRAPHY.fontSize);
  });

  it("builds safely quoted UI and monospace stacks", () => {
    expect(typographyFontStacks("")).toEqual({
      ui: DEFAULT_UI_FONT_STACK,
      mono: DEFAULT_TERMINAL_FONT_STACK,
    });
    const custom = typographyFontStacks('Mono "Alt"');
    expect(custom.ui).toBe(`"Mono \\"Alt\\"", ${DEFAULT_UI_FONT_STACK}`);
    expect(custom.mono).toBe(`"Mono \\"Alt\\"", ${DEFAULT_TERMINAL_FONT_STACK}`);
  });

  it("migrates the previous terminal-only fields", () => {
    expect(parseTypography('{"terminalFontFamily":"Iosevka","terminalFontSize":17}'))
      .toEqual({
        fontFamily: "Iosevka",
        fontSize: 17,
        activeImportedFont: null,
        importedFonts: [],
      });
  });

  it("migrates the previous single imported font and its selected state", () => {
    const legacy = parseTypography(JSON.stringify({ fontFamily: "Iosevka", importedFont: LEGACY_FONT }));
    expect(legacy.importedFonts).toEqual([LEGACY_FONT]);
    expect(legacy.activeImportedFont).toBe(LEGACY_FONT.fileName);

    const switched = parseTypography(JSON.stringify({
      fontFamily: "Iosevka",
      fontSource: "system",
      importedFont: LEGACY_FONT,
    }));
    expect(switched.importedFonts).toEqual([LEGACY_FONT]);
    expect(switched.activeImportedFont).toBeNull();
  });

  it("keeps multiple imported fonts and deduplicates their managed file names", () => {
    const parsed = parseTypography(JSON.stringify({
      activeImportedFont: SECOND_FONT.fileName,
      importedFonts: [LEGACY_FONT, SECOND_FONT, SECOND_FONT],
    }));
    expect(parsed.importedFonts).toEqual([LEGACY_FONT, SECOND_FONT]);
    expect(parsed.activeImportedFont).toBe(SECOND_FONT.fileName);

    const invalidSelection = parseTypography(JSON.stringify({
      activeImportedFont: "imported-missing.ttf",
      importedFonts: [LEGACY_FONT],
    }));
    expect(invalidSelection.activeImportedFont).toBeNull();
  });

  it("resolves any selected imported font without removing the library", () => {
    const imported = {
      ...DEFAULT_TYPOGRAPHY,
      fontFamily: "Iosevka",
      activeImportedFont: SECOND_FONT.fileName,
      importedFonts: [LEGACY_FONT, SECOND_FONT],
    };
    expect(resolveTypographyFontFamily(imported, true))
      .toBe(importedFontFamily(SECOND_FONT.fileName));
    expect(resolveTypographyFontFamily(imported, false)).toBe("Iosevka");
    expect(resolveTypographyFontFamily({ ...imported, activeImportedFont: null }, true))
      .toBe("Iosevka");
  });

  it("keeps only complete imported font metadata", () => {
    const importedFont = { ...LEGACY_FONT, displayName: "  Maple\nMono  " };
    const parsed = parseTypography(JSON.stringify({
      importedFonts: [importedFont, { ...SECOND_FONT, fileName: "../font.otf" }],
    }));
    expect(parsed.importedFonts)
      .toEqual([{ ...importedFont, displayName: "Maple Mono" }]);
  });

  it("scales every UI text token from the selected size", () => {
    expect(typographySizeTokens(15)).toEqual({ xs: 12, sm: 13, md: 14, display: 20 });
    expect(typographySizeTokens(20)).toEqual({ xs: 17, sm: 18, md: 19, display: 25 });
    expect(typographySizeTokens(10)).toEqual({ xs: 10, sm: 10, md: 10, display: 15 });
  });

  it("falls back to defaults when storage throws", () => {
    const storage = {
      getItem() {
        throw new Error("storage disabled");
      },
    };
    expect(loadTypography(storage)).toEqual(DEFAULT_TYPOGRAPHY);
  });
});
