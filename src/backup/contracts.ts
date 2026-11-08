import { errorMessage as localizedErrorMessage } from "../i18n";
import { TranslationError, localized, t } from "../i18n";
import type { BackgroundConfig } from "../background/contracts";
import type { ThemeMode } from "../theme/contracts";
import type { WorkspaceCollection } from "../workspace/named/contracts";
import type { RecentProject } from "../workspace/contracts";

export type BackupDomain = "workspace" | "appearance";
export interface WorkspaceBackup {
  state: { tabs: Record<string, unknown>[]; activeTabId: string | null };
  recent: RecentProject[];
  groups: WorkspaceCollection;
}
export interface AppearanceBackup {
  theme: ThemeMode | null;
  typography: { fontFamily: string; fontSize: number };
  background: Omit<BackgroundConfig, "fileName" | "mime">;
}
export interface BackupPackage {
  format: "belfry.backup";
  version: 1;
  createdAt: string;
  domains: { workspace?: WorkspaceBackup; appearance?: AppearanceBackup };
}
export type BackupStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type RawSnapshot = Record<string, string | null>;
export const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
export const BACKUP_PENDING_KEY = "belfry.backup.pending.v1";
export const BACKUP_TRANSACTION_KEY = "belfry.backup.transaction.v1";
export const BACKUP_UNDO_KEY = "belfry.backup.undo.v1";
export const BACKUP_STATUS_KEY = "belfry.backup.status.v1";
export const DOMAIN_LABELS: Record<BackupDomain, string> = localized(() => ({ workspace: t("backup.contracts.text_237e1bf23b"), appearance: t("backup.contracts.text_637b915e54") }));

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function message(error: unknown) { return localizedErrorMessage(error); }
export function assertSize(raw: string, max = MAX_BACKUP_BYTES) {
  if (raw.length > max || new TextEncoder().encode(raw).length > max) throw new TranslationError("backup.contracts.text_118c95e4bf");
}
