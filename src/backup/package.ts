import { TranslationError } from "../i18n";
import { BACKGROUND_FITS, MAX_BLUR } from "../background/contracts";
import { BACKGROUND_KEY, parseBackground } from "../background/storage";
import { THEME_MODE_KEY, parseThemeMode } from "../theme/storage";
import { MAX_FONT_FAMILY_LENGTH, MAX_FONT_SIZE, MIN_FONT_SIZE } from "../typography/contracts";
import { TYPOGRAPHY_KEY, parseTypography } from "../typography/storage";
import { NAMED_WORKSPACES_KEY } from "../workspace/named/contracts";
import { RECENT_PROJECTS_KEY, WORKSPACE_STATE_KEY } from "../workspace/storage";
import { assertSize, record, type AppearanceBackup, type BackupPackage } from "./contracts";
import { cleanWorkspace } from "./workspace";

export function createBackup(storage: Pick<Storage, "getItem"> = localStorage): BackupPackage {
  const state = JSON.parse(storage.getItem(WORKSPACE_STATE_KEY) ?? '{"tabs":[],"activeTabId":null}');
  const groups = storage.getItem(NAMED_WORKSPACES_KEY);
  const typography = parseTypography(storage.getItem(TYPOGRAPHY_KEY));
  const { fileName: _file, mime: _mime, ...background } = parseBackground(storage.getItem(BACKGROUND_KEY));
  const backup: BackupPackage = { format: "belfry.backup", version: 1, createdAt: new Date().toISOString(), domains: {
    workspace: cleanWorkspace({ state, recent: JSON.parse(storage.getItem(RECENT_PROJECTS_KEY) ?? "[]"),
      groups: groups === null ? undefined : JSON.parse(groups) }),
    appearance: { theme: parseThemeMode(storage.getItem(THEME_MODE_KEY)),
      typography: { fontFamily: typography.fontFamily, fontSize: typography.fontSize }, background },
  } };
  return parseBackup(JSON.stringify(backup));
}

export function parseBackup(raw: string): BackupPackage {
  assertSize(raw);
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.format !== "belfry.backup" || value.version !== 1) throw new TranslationError("backup.package.text_2dcaf7c880");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw new TranslationError("backup.package.text_53e91800e7");
  if (!record(value.domains) || !Object.keys(value.domains).length
    || Object.keys(value.domains).some((key) => key !== "appearance" && key !== "workspace")) throw new TranslationError("backup.package.text_69c833881c");
  return { format: "belfry.backup", version: 1, createdAt: new Date(value.createdAt).toISOString(), domains: {
    ...(value.domains.workspace === undefined ? {} : { workspace: cleanWorkspace(value.domains.workspace) }),
    ...(value.domains.appearance === undefined ? {} : { appearance: cleanAppearance(value.domains.appearance) }),
  } };
}

function cleanAppearance(value: unknown): AppearanceBackup {
  if (!record(value) || !record(value.typography) || !record(value.background)) throw new TranslationError("backup.package.text_12d236402b");
  if (value.theme !== null && value.theme !== "light" && value.theme !== "dark") throw new TranslationError("backup.package.text_5ae53a9cc7");
  const font = value.typography;
  if (typeof font.fontFamily !== "string" || font.fontFamily.length > MAX_FONT_FAMILY_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(font.fontFamily)) throw new TranslationError("backup.package.text_3d2200f1e6");
  const background = value.background;
  if (!BACKGROUND_FITS.includes(background.fit as never) || !record(background.veil)
    || typeof background.videoPaused !== "boolean") throw new TranslationError("backup.package.text_27a06e2c77");
  return { theme: value.theme, typography: { fontFamily: font.fontFamily,
    fontSize: finite(font.fontSize, [MIN_FONT_SIZE, MAX_FONT_SIZE]) }, background: {
    fit: background.fit as AppearanceBackup["background"]["fit"], opacity: finite(background.opacity, [0, 1]),
    blur: finite(background.blur, [0, MAX_BLUR]), videoPaused: background.videoPaused,
    veil: { dark: finite(background.veil.dark, [0, 1]), light: finite(background.veil.light, [0, 1]) },
  } };
}

function finite(value: unknown, range: [number, number]) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) {
    throw new TranslationError("backup.package.text_12ce7a49cb");
  }
  return value;
}
