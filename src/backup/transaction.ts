import { BACKUP_PENDING_KEY, BACKUP_STATUS_KEY, BACKUP_TRANSACTION_KEY, BACKUP_UNDO_KEY, MAX_BACKUP_BYTES,
  assertSize, message, record, type BackupDomain, type BackupPackage, type BackupStorage } from "./contracts";
import { parseBackup } from "./package";
import { capture, restoreTargets, writeSnapshot, writeValue } from "./snapshots";
import { parseTransaction, readUndo, recordStatus, rollback, validateDomains, type BackupTransaction } from "./journal";

export function scheduleRestore(input: { backup: BackupPackage; domains: BackupDomain[] }, storage: BackupStorage = localStorage) {
  assertQueueAvailable(storage);
  const backup = parseBackup(JSON.stringify(input.backup));
  const domains = validateDomains(input.domains);
  if (domains.some((domain) => !backup.domains[domain])) throw new Error("备份没有所选数据域");
  const selected = Object.fromEntries(domains.map((domain) => [domain, backup.domains[domain]]));
  writeValue(storage, BACKUP_PENDING_KEY, JSON.stringify({ version: 1, mode: "restore", domains,
    backup: { ...backup, domains: selected } }));
}

export function scheduleUndo(storage: BackupStorage = localStorage) {
  assertQueueAvailable(storage);
  const { raw } = readUndo(storage);
  writeValue(storage, BACKUP_PENDING_KEY, JSON.stringify({ version: 1, mode: "undo", expectedUndo: raw }));
}

export function cancelPendingBackup(storage: BackupStorage = localStorage) {
  if (storage.getItem(BACKUP_TRANSACTION_KEY) !== null) throw new Error("恢复事务尚未回滚，请重新启动后重试");
  writeValue(storage, BACKUP_PENDING_KEY, null);
}

export function backupStatus(storage: Pick<Storage, "getItem"> = localStorage) {
  const status = JSON.parse(storage.getItem(BACKUP_STATUS_KEY) ?? "{}");
  const raw = storage.getItem(BACKUP_PENDING_KEY);
  const pending = raw ? JSON.parse(raw) : null;
  const undo = storage.getItem(BACKUP_UNDO_KEY);
  return { pending: pending?.mode === "undo" ? "undo" : pending ? "restore" : null,
    undoAvailable: undo !== null, message: typeof status.message === "string" ? status.message : "" };
}

/** 在任何工作区或外观 Provider 挂载前调用；失败回滚不成功时阻止挂载。 */
export function applyPendingBackup(storage: BackupStorage = localStorage): { error: string | null } {
  try {
    const interrupted = storage.getItem(BACKUP_TRANSACTION_KEY);
    if (interrupted) { rollback(storage, parseTransaction(interrupted), "上次启动意外中断"); return { error: null }; }
    const pending = storage.getItem(BACKUP_PENDING_KEY);
    if (!pending) return { error: null };
    const transaction = prepareTransaction(pending, storage);
    writeValue(storage, BACKUP_TRANSACTION_KEY, JSON.stringify(transaction));
    executeTransaction(transaction, storage);
    return { error: null };
  } catch (error) { return { error: message(error) }; }
}

function executeTransaction(transaction: BackupTransaction, storage: BackupStorage) {
  try {
    writeSnapshot(storage, transaction.after);
    const undo = transaction.mode === "restore" ? JSON.stringify({ ...transaction, previousUndo: null }) : null;
    writeValue(storage, BACKUP_UNDO_KEY, undo);
    recordStatus(storage, transaction.mode === "restore" ? "已恢复所选数据域，可撤回最近一次恢复。" : "已撤回最近一次恢复。");
    writeValue(storage, BACKUP_PENDING_KEY, null);
    writeValue(storage, BACKUP_TRANSACTION_KEY, null);
  } catch (error) {
    rollback(storage, transaction, message(error));
  }
}

function prepareTransaction(raw: string, storage: BackupStorage): BackupTransaction {
  assertSize(raw, MAX_BACKUP_BYTES * 3);
  const request: unknown = JSON.parse(raw);
  if (!record(request) || request.version !== 1) throw new Error("待恢复记录的版本无效");
  let after;
  if (request.mode === "restore") {
    const backup = parseBackup(JSON.stringify(request.backup));
    const domains = validateDomains(request.domains);
    if (domains.some((domain) => !backup.domains[domain])) throw new Error("待恢复记录缺少所选域");
    after = restoreTargets(backup, domains, storage);
  } else if (request.mode === "undo") {
    const undo = readUndo(storage);
    if (request.expectedUndo !== undo.raw) throw new Error("撤回记录已变化，请取消并重新预览");
    after = undo.transaction.before;
  } else throw new Error("待恢复操作无效");
  return { version: 1, id: crypto.randomUUID(), mode: request.mode,
    before: capture(Object.keys(after), storage), after, previousUndo: storage.getItem(BACKUP_UNDO_KEY) };
}

function assertQueueAvailable(storage: Pick<Storage, "getItem">) {
  if (storage.getItem(BACKUP_PENDING_KEY) !== null || storage.getItem(BACKUP_TRANSACTION_KEY) !== null) {
    throw new Error("已有待恢复操作，请先取消或完成");
  }
}
