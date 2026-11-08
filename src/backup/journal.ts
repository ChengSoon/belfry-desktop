import { TranslationError, t } from "../i18n";
import { BACKUP_PENDING_KEY, BACKUP_STATUS_KEY, BACKUP_TRANSACTION_KEY, BACKUP_UNDO_KEY, MAX_BACKUP_BYTES,
  assertSize, record, type BackupDomain, type BackupStorage, type RawSnapshot } from "./contracts";
import { validateSnapshot, writeSnapshot, writeValue } from "./snapshots";

export interface BackupTransaction {
  version: 1; id: string; mode: "restore" | "undo";
  before: RawSnapshot; after: RawSnapshot; previousUndo: string | null;
}

export function parseTransaction(raw: string): BackupTransaction {
  assertSize(raw, MAX_BACKUP_BYTES * 4);
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1 || typeof value.id !== "string"
    || (value.mode !== "restore" && value.mode !== "undo")
    || (value.previousUndo !== null && typeof value.previousUndo !== "string")) throw new TranslationError("backup.journal.text_972d3b787c");
  const before = validateSnapshot(value.before), after = validateSnapshot(value.after);
  if (!Object.keys(before).length || JSON.stringify(Object.keys(before).sort()) !== JSON.stringify(Object.keys(after).sort())) {
    throw new TranslationError("backup.journal.text_fb5e5db7ef");
  }
  return { version: 1, id: value.id, mode: value.mode, before, after, previousUndo: value.previousUndo };
}

export function readUndo(storage: Pick<Storage, "getItem">) {
  const raw = storage.getItem(BACKUP_UNDO_KEY);
  if (!raw) throw new TranslationError("backup.journal.text_d4d6d978e9");
  return { raw, transaction: parseTransaction(raw) };
}

export function recordStatus(storage: BackupStorage, text: string) {
  writeValue(storage, BACKUP_STATUS_KEY, JSON.stringify({ message: text, time: new Date().toISOString() }));
}

export function rollback(storage: BackupStorage, transaction: BackupTransaction, reason: string) {
  writeSnapshot(storage, transaction.before);
  writeValue(storage, BACKUP_UNDO_KEY, transaction.previousUndo);
  recordStatus(storage, t("backup.journal.text_83fd97f9c8", { reason: reason }));
  writeValue(storage, BACKUP_PENDING_KEY, null);
  writeValue(storage, BACKUP_TRANSACTION_KEY, null);
}

export function validateDomains(value: unknown): BackupDomain[] {
  if (!Array.isArray(value) || !value.length || value.length > 2
    || value.some((domain) => domain !== "appearance" && domain !== "workspace")
    || new Set(value).size !== value.length) throw new TranslationError("backup.journal.text_867822bf42");
  return value;
}
