import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isObject } from "./manifest.mjs";
import { apiError } from "./errors.mjs";
const writes = new Map();
const MAX_SETTINGS_BYTES = 1024 * 1024;

export async function dataPath(base, id) {
  const path = join(base, "data", createHash("sha256").update(id).digest("hex"));
  await mkdir(path, { recursive: true });
  return path;
}
export async function getSettings(base, manifest) {
  const defaults = Object.fromEntries((manifest.contributes?.settings ?? []).map((entry) => [entry.key ?? entry.id, entry.default]));
  const file = join(await dataPath(base, manifest.id), "settings.json");
  try {
    const bytes = await readFile(file);
    if (bytes.length > MAX_SETTINGS_BYTES) throw apiError("LIMIT_EXCEEDED", `设置文件超过 1 MiB，原文件已保留：${file}。请先复制导出该文件，再精简内容到 1 MiB 内并重新加载插件。`);
    const stored = JSON.parse(bytes.toString("utf8"));
    if (!isObject(stored)) throw apiError("INVALID_ARGUMENT", "设置文件无效");
    return { ...defaults, ...stored };
  } catch (error) { if (error.code !== "ENOENT") throw error; return defaults; }
}
export async function setSettings(base, manifest, partial) {
  const key = `${base}:${manifest.id}`;
  const next = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(() => saveSettings(base, manifest, partial));
  writes.set(key, next);
  try { return await next; } finally { if (writes.get(key) === next) writes.delete(key); }
}
async function saveSettings(base, manifest, partial) {
  if (!isObject(partial) || Buffer.byteLength(JSON.stringify(partial)) > 64 * 1024) throw apiError("INVALID_ARGUMENT", "设置必须为有界对象");
  for (const setting of manifest.contributes?.settings ?? []) {
    if (!Object.hasOwn(partial, setting.key)) continue;
    validateSettingValue(setting, partial[setting.key]);
  }
  const values = { ...await getSettings(base, manifest), ...partial };
  // 读取上限约束的是最终磁盘字节；默认值、UTF-8 和缩进都必须计入。
  const contents = JSON.stringify(values, null, 2);
  if (Buffer.byteLength(contents, "utf8") > MAX_SETTINGS_BYTES) throw apiError("LIMIT_EXCEEDED", "合并后的设置超过 1 MiB，原文件未修改");
  const root = await dataPath(base, manifest.id);
  const temporary = join(root, `.settings-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
    await rename(temporary, join(root, "settings.json"));
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
  return values;
}
function validateSettingValue(setting, value) {
  const type = setting.type === "shortcut" ? "string" : setting.type;
  if (["string", "number", "boolean"].includes(type) && typeof value !== type) throw apiError("INVALID_ARGUMENT", `${setting.key} 类型无效`);
  if (type === "number" && !Number.isFinite(value)) throw apiError("INVALID_ARGUMENT", "数字无效");
  if (Array.isArray(setting.enum) && !setting.enum.some((option) => (isObject(option) ? option.value : option) === value)) throw apiError("INVALID_ARGUMENT", "设置选项无效");
}
