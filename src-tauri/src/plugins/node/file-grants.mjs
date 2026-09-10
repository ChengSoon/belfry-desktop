import { lstat, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { apiError, permission } from "./errors.mjs";

const DROP_TTL = 15_000;
const MAX_GRANTS = 128;
const PROTECTED_PART = /^(?:\.git|\.ssh|\.aws|\.config|\.codex|\.claude|\.env(?:\..*)?|credentials(?:\..*)?|id_rsa|id_ed25519)$/i;
const MIME = { ".txt": "text/plain", ".log": "text/plain", ".csv": "text/csv", ".json": "application/json", ".html": "text/html",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf" };
async function checkedFile(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) throw apiError("INVALID_ARGUMENT", "需要绝对文件路径");
  const full = await realpath(path), meta = await lstat(path);
  if (!meta.isFile() || meta.isSymbolicLink() || full.split(/[\\/]/).some((part) => PROTECTED_PART.test(part))) {
    throw apiError("PERMISSION_DENIED", "无法授权链接、特殊文件或受保护文件");
  }
  return { path: resolve(path), full, name: basename(full), size: meta.size, mtimeMs: meta.mtimeMs,
    dev: meta.dev, ino: meta.ino, type: MIME[extname(full).toLowerCase()] ?? "" };
}
export async function recordDropped(entry, paths) {
  permission(entry, "fs.read");
  if (!Array.isArray(paths) || paths.length > MAX_GRANTS) throw apiError("INVALID_ARGUMENT", "文件数量超额");
  entry.pendingDrops ??= new Map();
  entry.selections ??= new Map();
  for (const [path, value] of entry.pendingDrops) if (value.expires <= Date.now()) entry.pendingDrops.delete(path);
  const files = [];
  for (const path of paths) {
    const file = await checkedFile(path);
    entry.pendingDrops.set(file.path, { ...file, expires: Date.now() + DROP_TTL });
    const selectionId = randomUUID();
    entry.selections.set(selectionId, file);
    files.push({ ...file, selectionId });
  }
  while (entry.pendingDrops.size > MAX_GRANTS) entry.pendingDrops.delete(entry.pendingDrops.keys().next().value);
  while (entry.selections.size > MAX_GRANTS) entry.selections.delete(entry.selections.keys().next().value);
  return files;
}
export async function selectedFile(entry, selectionId) {
  permission(entry, "fs.read");
  const expected = entry.selections?.get(selectionId);
  if (!expected) throw apiError("PERMISSION_DENIED", "所选文件的授权已失效，请重新选择");
  const current = await checkedFile(expected.path);
  if (["full", "dev", "ino", "size", "mtimeMs"].some((key) => current[key] !== expected[key])) {
    throw apiError("FILE_CHANGED", "所选文件已更改，请重新选择");
  }
  return expected;
}
export async function registerDropped(entry, path) {
  permission(entry, "fs.read");
  const pending = typeof path === "string" ? entry.pendingDrops?.get(resolve(path)) : null;
  if (!pending || pending.expires <= Date.now()) throw apiError("PERMISSION_DENIED", "文件未经本插件窗口拖入或选择");
  entry.pendingDrops.delete(resolve(path));
  const file = await checkedFile(path);
  if (file.full !== pending.full) throw apiError("PERMISSION_DENIED", "文件路径已改变");
  entry.fileGrants ??= new Map();
  if (entry.fileGrants.size >= MAX_GRANTS) throw apiError("LIMIT_EXCEEDED", "已授权文件过多，请重载插件");
  const grantId = randomUUID(); entry.fileGrants.set(grantId, file);
  return { grantId };
}
export async function grantedPath(entry, path, grantId) {
  permission(entry, "fs.read");
  const grant = entry.fileGrants?.get(grantId);
  if (!grant || typeof path !== "string" || !isAbsolute(path) || resolve(path) !== grant.path) {
    throw apiError("PERMISSION_DENIED", "文件路径与授权不匹配，或授权已失效");
  }
  const file = await checkedFile(path);
  if (file.full !== grant.full) throw apiError("PERMISSION_DENIED", "授权文件路径已改变");
  return file.full;
}
