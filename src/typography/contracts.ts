export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 20;
export const MAX_FONT_FAMILY_LENGTH = 80;

const IMPORTED_FONT_FAMILY_PREFIX = "Belfry Imported Font";

export function importedFontFamily(fileName: string) {
  const token = fileName.replace(/[^a-zA-Z0-9]/g, "-");
  return `${IMPORTED_FONT_FAMILY_PREFIX} ${token}`;
}

export const DEFAULT_UI_FONT_STACK =
  '"HarmonyOS Sans SC", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';

export const DEFAULT_TERMINAL_FONT_STACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", "Cascadia Mono", Consolas, "JetBrains Mono", monospace';

export interface ImportedFontAsset {
  fileName: string;
  displayName: string;
  mime: string;
  byteSize: number;
}

export interface TypographyConfig {
  /** 空字符串表示使用应用内置的系统字体栈。 */
  fontFamily: string;
  fontSize: number;
  /** null 表示使用 fontFamily；否则保存当前导入字体的受管文件名。 */
  activeImportedFont: string | null;
  importedFonts: ImportedFontAsset[];
}

export interface TypographyRuntime {
  fontFamily: string;
  fontSize: number;
}

export interface TypographyController {
  config: TypographyConfig;
  runtime: TypographyRuntime;
  busy: boolean;
  error: string | null;
  update: (patch: Partial<TypographyConfig>) => void;
  pick: () => Promise<void>;
  clearImported: (fileName: string) => Promise<void>;
  reset: () => Promise<void>;
}

export const DEFAULT_TYPOGRAPHY: TypographyConfig = {
  fontFamily: "",
  fontSize: 15,
  activeImportedFont: null,
  importedFonts: [],
};
