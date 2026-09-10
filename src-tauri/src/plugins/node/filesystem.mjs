import { constants } from "node:fs";
import { lstat, open, readdir, unlink } from "node:fs/promises";
import { extname } from "node:path";
import { apiError, permission } from "./errors.mjs";
import { cleanPath, FILE_LIMIT, filePath, matches, withinScope } from "./fs-policy.mjs";
import { grantedPath, recordDropped, registerDropped, selectedFile } from "./file-grants.mjs";

const RANGE_LIMIT = 512 * 1024;
async function readBytes(path, limit = FILE_LIMIT) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const meta = await handle.stat();
    if (!meta.isFile() || meta.size > limit) throw apiError("LIMIT_EXCEEDED", "文件类型或大小超额");
    const bytes = Buffer.alloc(Math.min(meta.size + 1, limit + 1));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > limit) throw apiError("LIMIT_EXCEEDED", "文件大小超额");
    return bytes.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
async function writeText(path, text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > FILE_LIMIT) throw apiError("LIMIT_EXCEEDED", "写入内容无效或超额");
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(text); } finally { await handle.close(); }
  return null;
}
async function list(entry, path, context) {
  const directory = await filePath(entry, { path, mode: "read", context, directory: true });
  const names = (await readdir(directory)).sort();
  if (names.length > 2000) throw apiError("LIMIT_EXCEEDED", "目录条目超额");
  const result = [];
  for (const name of names) {
    const relative = path && path !== "." ? `${path}/${name}` : name;
    try { cleanPath(relative); } catch { continue; }
    const meta = await lstat(`${directory}/${name}`);
    if (meta.isSymbolicLink() || (!meta.isDirectory() && !withinScope(entry, "read", relative))) continue;
    result.push({ name, path: relative, isDirectory: meta.isDirectory(), size: meta.size, mtimeMs: meta.mtimeMs });
  }
  return result;
}
async function glob(entry, pattern, context) {
  cleanPath(pattern);
  const result = [], queue = [""], maxEntries = 5000;
  let visited = 0;
  while (queue.length && visited < maxEntries) {
    for (const item of await list(entry, queue.shift(), context)) {
      if (++visited > maxEntries) throw apiError("LIMIT_EXCEEDED", "遍历文件超额");
      if (item.isDirectory && item.path.split("/").length < 12) queue.push(item.path);
      else if (!item.isDirectory && matches(pattern, item.path)) result.push(item.path);
    }
  }
  return result;
}
async function preview(path) {
  const meta = await lstat(path);
  if (meta.size > FILE_LIMIT) return { kind: "tooLarge", size: meta.size };
  const bytes = await readBytes(path);
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[extname(path).toLowerCase()];
  if (mime) return { kind: "image", size: bytes.length, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
  try { return { kind: "text", size: bytes.length, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }; }
  catch { return { kind: "binary", size: bytes.length }; }
}
async function range(path, { offset, length, expected }) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > RANGE_LIMIT) throw apiError("INVALID_ARGUMENT", "读取范围无效");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const meta = await handle.stat();
    if (!meta.isFile()) throw apiError("INVALID_ARGUMENT", "请选择文件");
    if (expected && ["dev", "ino", "size", "mtimeMs"].some((key) => meta[key] !== expected[key])) throw apiError("FILE_CHANGED", "所选文件已更改，请重新选择");
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, offset);
    return { bytes: bytes.subarray(0, bytesRead).toString("base64"), encoding: "base64", totalSize: meta.size };
  } finally { await handle.close(); }
}
async function fileSelection({ entry, api, args, platform }) {
  if (api === "fs.registerDropped") return registerDropped(entry, args[0]);
  if (api === "fs.readSelection") {
    const expected = await selectedFile(entry, args[0]);
    return range(expected.full, { offset: args[1], length: args[2], expected });
  }
  if (api === "fs.pickFiles") {
    permission(entry, "fs.read");
    const paths = await platform({ api, pluginId: entry.manifest.id, args });
    return recordDropped(entry, paths ?? []);
  }
  if (api === "fs.requestDirectory") {
    if (!["read", "write", "delete"].some((mode) => entry.manifest.fs?.[mode]?.root === "userSelected")) throw apiError("PERMISSION_DENIED", "未声明 userSelected 文件范围");
    const value = await platform({ api, pluginId: entry.manifest.id, args: [] });
    entry.directoryGrant = value?.path;
    return value;
  }
}
export async function filesystem(input) {
  const { entry, api, args, context } = input;
  if (["fs.registerDropped", "fs.readSelection", "fs.pickFiles", "fs.requestDirectory"].includes(api)) return fileSelection(input);
  if (api === "fs.list") return list(entry, args[0] ?? "", context);
  if (api === "fs.glob") { permission(entry, "fs.read"); return glob(entry, args[0], context); }
  return fileOperation(input);
}
async function fileOperation({ entry, api, args, context, platform }) {
  const mode = api === "fs.writeText" ? "write" : api === "fs.remove" ? "delete" : "read";
  const grantId = api === "fs.stat" ? args[1] : api === "fs.readRange" ? args[3] : undefined;
  const path = grantId != null ? await grantedPath(entry, args[0], grantId)
    : await filePath(entry, { path: args[0], mode, context, create: mode === "write" });
  const openFile = () => platform({ api, pluginId: entry.manifest.id, args: [path] });
  const handlers = {
    "fs.readText": async () => new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(path)),
    "fs.writeText": () => writeText(path, args[1]),
    "fs.remove": async () => { if (!(await lstat(path)).isFile()) throw apiError("PERMISSION_DENIED", "仅允许删除单个文件"); await unlink(path); return null; },
    "fs.stat": async () => { const meta = await lstat(path); return { size: meta.size, mtimeMs: meta.mtimeMs }; },
    "fs.readRange": () => range(path, { offset: args[1], length: args[2] }),
    "fs.readPreview": () => preview(path), "fs.openDefault": openFile, "fs.reveal": openFile,
  };
  if (!Object.hasOwn(handlers, api)) throw apiError("UNSUPPORTED", api);
  return handlers[api]();
}
