import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { apiError } from "./errors.mjs";

const INITIAL_LOCK_GRACE_MS = 60_000;
const acquiring = new Set();
export async function directoryAt(directory) {
  await mkdir(directory, { recursive: true });
  const meta = await lstat(directory);
  if (!meta.isDirectory() || meta.isSymbolicLink()) throw apiError("INVALID_ARGUMENT", "市场目录不能为符号链接或文件");
  return realpath(directory);
}
export function inside(root, target, paths = path) {
  const relative = paths.relative(root, target);
  return !relative || relative !== ".." && !relative.startsWith(".." + paths.sep) && !paths.isAbsolute(relative);
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}
const busy = () => apiError("BUSY", "此市场正在发布或恢复，请稍后重试");
const ownerAt = (lock) => readFile(path.join(lock, "owner.json"), "utf8").then(JSON.parse).catch(() => null);
function assertStale(meta, owner) {
  if (!meta.isDirectory() || meta.isSymbolicLink()) throw apiError("INVALID_ARGUMENT", "市场发布锁不是普通目录");
  if (owner ? processAlive(owner.pid) : Date.now() - meta.mtimeMs < INITIAL_LOCK_GRACE_MS) throw busy();
}
async function claim(lock) {
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    await recoverLock(lock);
    await mkdir(lock).catch((reason) => { throw reason.code === "EEXIST" ? busy() : reason; });
  }
  const token = randomUUID();
  await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, token }), { flag: "wx", mode: 0o600 });
  return token;
}
async function release(lock, token) {
  if ((await ownerAt(lock))?.token === token) await rm(lock, { recursive: true, force: true });
}
async function recoverLock(lock) {
  const meta = await lstat(lock).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (!meta) return;
  assertStale(meta, await ownerAt(lock));
  // 恢复标记也记录进程身份：恢复者崩溃后，下次可继续回收。
  const marker = path.join(lock, "recovering");
  const token = await claim(marker);
  try {
    const current = await lstat(lock);
    if (current.dev !== meta.dev || current.ino !== meta.ino) throw busy();
    assertStale(meta, await ownerAt(lock));
    const abandoned = `${lock}.abandoned-${randomUUID()}`;
    await rename(lock, abandoned);
    await rm(abandoned, { recursive: true, force: true });
  } finally { await release(marker, token); }
}
export async function marketLock(root, operation) {
  const directory = await directoryAt(root), lock = path.join(directory, ".publish-lock");
  if (acquiring.has(directory)) throw apiError("BUSY", "此市场正在发布，请稍后重试");
  acquiring.add(directory);
  try {
    const token = await claim(lock);
    try { return await operation(); }
    finally { await release(lock, token); }
  } finally { acquiring.delete(directory); }
}
