import {
  DEFAULT_TERMINAL_FONT_STACK,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_UI_FONT_STACK,
  MAX_FONT_FAMILY_LENGTH,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type ImportedFontAsset,
  type TypographyConfig,
  importedFontFamily,
} from "./contracts";

export const TYPOGRAPHY_KEY = "belfry.typography.v1";
const MANAGED_FONT_FILE = /^(?:custom-font|imported-[a-z0-9]{26})\.(?:ttf|otf|woff|woff2)$/i;

export function loadTypography(
  storage: Pick<Storage, "getItem"> = localStorage,
): TypographyConfig {
  try {
    return parseTypography(storage.getItem(TYPOGRAPHY_KEY));
  } catch {
    return DEFAULT_TYPOGRAPHY;
  }
}

export function saveTypography(
  config: TypographyConfig,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  try {
    storage.setItem(TYPOGRAPHY_KEY, JSON.stringify(config));
  } catch {
    // 字体设置不是关键数据，存储不可用时保留本次运行内的选择即可。
  }
}

export function parseTypography(value: string | null): TypographyConfig {
  if (!value) return DEFAULT_TYPOGRAPHY;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return DEFAULT_TYPOGRAPHY;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return DEFAULT_TYPOGRAPHY;
  }
  const record = raw as Record<string, unknown>;
  const legacyFont = parseImportedFont(record.importedFont);
  const importedFonts = parseImportedFonts(record.importedFonts, legacyFont);
  return {
    fontFamily: normalizeFontFamily(record.fontFamily ?? record.terminalFontFamily),
    fontSize: normalizeFontSize(record.fontSize ?? record.terminalFontSize),
    activeImportedFont: parseActiveImportedFont(record, importedFonts, legacyFont),
    importedFonts,
  };
}

export function resolveTypographyFontFamily(config: TypographyConfig, importedReady: boolean) {
  const imported = findActiveImportedFont(config);
  return imported && importedReady
    ? importedFontFamily(imported.fileName)
    : config.fontFamily;
}

export function findActiveImportedFont(config: TypographyConfig) {
  return config.importedFonts.find((font) => font.fileName === config.activeImportedFont) ?? null;
}

/** 自定义值只作为单个字体名称使用，始终加引号，不能注入额外 CSS 声明。 */
export function typographyFontStacks(fontFamily: string) {
  const normalized = normalizeFontFamily(fontFamily);
  if (!normalized) return { ui: DEFAULT_UI_FONT_STACK, mono: DEFAULT_TERMINAL_FONT_STACK };
  const quoted = normalized.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return {
    ui: `"${quoted}", ${DEFAULT_UI_FONT_STACK}`,
    mono: `"${quoted}", ${DEFAULT_TERMINAL_FONT_STACK}`,
  };
}

function normalizeFontFamily(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_TYPOGRAPHY.fontFamily;
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FONT_FAMILY_LENGTH);
}

function normalizeFontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TYPOGRAPHY.fontSize;
  }
  return Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value)));
}

function parseImportedFonts(value: unknown, legacyFont: ImportedFontAsset | null) {
  const candidates: unknown[] = Array.isArray(value) ? [...value] : [];
  if (legacyFont) candidates.unshift(legacyFont);
  const seen = new Set<string>();
  const fonts: ImportedFontAsset[] = [];
  for (const candidate of candidates) {
    const font = parseImportedFont(candidate);
    if (!font || seen.has(font.fileName)) continue;
    seen.add(font.fileName);
    fonts.push(font);
  }
  return fonts;
}

function parseActiveImportedFont(
  record: Record<string, unknown>,
  fonts: ImportedFontAsset[],
  legacyFont: ImportedFontAsset | null,
) {
  const selected = record.activeImportedFont;
  if (typeof selected === "string" && fonts.some((font) => font.fileName === selected)) {
    return selected;
  }
  if ("activeImportedFont" in record || record.fontSource === "system") return null;
  if (legacyFont && (record.fontSource === "imported" || !("fontSource" in record))) {
    return legacyFont.fileName;
  }
  return null;
}

function parseImportedFont(value: unknown): ImportedFontAsset | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const asset = value as Record<string, unknown>;
  const displayName = normalizeFontFamily(asset.displayName);
  if (!isNonEmptyString(asset.fileName)
    || !MANAGED_FONT_FILE.test(asset.fileName)
    || !displayName
    || !isNonEmptyString(asset.mime)
    || typeof asset.byteSize !== "number"
    || !Number.isSafeInteger(asset.byteSize)
    || asset.byteSize < 0) return null;
  return {
    fileName: asset.fileName,
    displayName,
    mime: asset.mime,
    byteSize: asset.byteSize,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
