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
  if (!record(value) || value.format !== "belfry.backup" || value.version !== 1) throw new Error("备份格式或版本不支持");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("备份时间无效");
  if (!record(value.domains) || !Object.keys(value.domains).length
    || Object.keys(value.domains).some((key) => key !== "appearance" && key !== "workspace")) throw new Error("备份数据域不支持");
  return { format: "belfry.backup", version: 1, createdAt: new Date(value.createdAt).toISOString(), domains: {
    ...(value.domains.workspace === undefined ? {} : { workspace: cleanWorkspace(value.domains.workspace) }),
    ...(value.domains.appearance === undefined ? {} : { appearance: cleanAppearance(value.domains.appearance) }),
  } };
}

function cleanAppearance(value: unknown): AppearanceBackup {
  if (!record(value) || !record(value.typography) || !record(value.background)) throw new Error("外观数据无效");
  if (value.theme !== null && value.theme !== "light" && value.theme !== "dark") throw new Error("备份主题无效");
  const font = value.typography;
  if (typeof font.fontFamily !== "string" || font.fontFamily.length > MAX_FONT_FAMILY_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(font.fontFamily)) throw new Error("备份字体无效");
  const background = value.background;
  if (!BACKGROUND_FITS.includes(background.fit as never) || !record(background.veil)
    || typeof background.videoPaused !== "boolean") throw new Error("备份背景参数无效");
  return { theme: value.theme, typography: { fontFamily: font.fontFamily,
    fontSize: finite(font.fontSize, [MIN_FONT_SIZE, MAX_FONT_SIZE]) }, background: {
    fit: background.fit as AppearanceBackup["background"]["fit"], opacity: finite(background.opacity, [0, 1]),
    blur: finite(background.blur, [0, MAX_BLUR]), videoPaused: background.videoPaused,
    veil: { dark: finite(background.veil.dark, [0, 1]), light: finite(background.veil.light, [0, 1]) },
  } };
}

function finite(value: unknown, range: [number, number]) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) {
    throw new Error("备份外观参数超出范围");
  }
  return value;
}
