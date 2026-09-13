import { BACKGROUND_KEY, parseBackground } from "../background/storage";
import { THEME_MODE_KEY } from "../theme/storage";
import { TYPOGRAPHY_KEY, parseTypography } from "../typography/storage";
import { NAMED_WORKSPACES_KEY } from "../workspace/named/contracts";
import { RECENT_PROJECTS_KEY, WORKSPACE_STATE_KEY } from "../workspace/storage";
import { assertSize, record, type BackupDomain, type BackupPackage, type BackupStorage, type RawSnapshot } from "./contracts";

export const DOMAIN_KEYS = {
  workspace: [WORKSPACE_STATE_KEY, NAMED_WORKSPACES_KEY, RECENT_PROJECTS_KEY],
  appearance: [THEME_MODE_KEY, TYPOGRAPHY_KEY, BACKGROUND_KEY],
};
const ALLOWED_KEYS = Object.values(DOMAIN_KEYS).flat();

export function capture(keys: string[], storage: Pick<Storage, "getItem">): RawSnapshot {
  const result = Object.fromEntries(keys.map((key) => [key, storage.getItem(key)]));
  return validateSnapshot(result);
}

export function validateSnapshot(value: unknown): RawSnapshot {
  if (!record(value) || Object.entries(value).some(([key, raw]) =>
    !ALLOWED_KEYS.includes(key) || (raw !== null && typeof raw !== "string"))) throw new Error("恢复快照包含无效数据域");
  assertSize(JSON.stringify(value));
  return value as RawSnapshot;
}

export function restoreTargets(backup: BackupPackage, domains: BackupDomain[], storage: Pick<Storage, "getItem">) {
  const targets: RawSnapshot = {};
  if (domains.includes("workspace") && backup.domains.workspace) {
    const { state, groups, recent } = backup.domains.workspace;
    targets[WORKSPACE_STATE_KEY] = JSON.stringify(state);
    targets[NAMED_WORKSPACES_KEY] = JSON.stringify(groups);
    targets[RECENT_PROJECTS_KEY] = JSON.stringify(recent);
  }
  if (domains.includes("appearance") && backup.domains.appearance) {
    const { theme, typography, background } = backup.domains.appearance;
    const localFont = parseTypography(storage.getItem(TYPOGRAPHY_KEY));
    const localBackground = parseBackground(storage.getItem(BACKGROUND_KEY));
    targets[THEME_MODE_KEY] = theme;
    targets[TYPOGRAPHY_KEY] = JSON.stringify({ ...localFont, ...typography, activeImportedFont: null });
    targets[BACKGROUND_KEY] = JSON.stringify({ ...localBackground, ...background });
  }
  return validateSnapshot(targets);
}

export function writeValue(storage: BackupStorage, key: string, value: string | null) {
  if (value === null) storage.removeItem(key); else storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error("恢复写入后回读不一致");
}

export function writeSnapshot(storage: BackupStorage, values: RawSnapshot) {
  for (const [key, raw] of Object.entries(validateSnapshot(values))) writeValue(storage, key, raw);
}
