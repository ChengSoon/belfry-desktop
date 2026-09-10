import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isObject } from "./manifest.mjs";
import { apiError } from "./errors.mjs";
const writes = new Map();

export async function dataPath(base, id) {
  const path = join(base, "data", createHash("sha256").update(id).digest("hex"));
  await mkdir(path, { recursive: true });
  return path;
}
export async function getSettings(base, manifest) {
  const defaults = Object.fromEntries((manifest.contributes?.settings ?? []).map((entry) => [entry.key ?? entry.id, entry.default]));
  try {
    const bytes = await readFile(join(await dataPath(base, manifest.id), "settings.json"));
    if (bytes.length > 1024 * 1024) throw apiError("LIMIT_EXCEEDED", "设置文件过大");
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
  const root = await dataPath(base, manifest.id);
  const temporary = join(root, `.settings-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(values, null, 2), { flag: "wx", mode: 0o600 });
  await rename(temporary, join(root, "settings.json"));
  return values;
}
function validateSettingValue(setting, value) {
  const type = setting.type === "shortcut" ? "string" : setting.type;
  if (["string", "number", "boolean"].includes(type) && typeof value !== type) throw apiError("INVALID_ARGUMENT", `${setting.key} 类型无效`);
  if (type === "number" && !Number.isFinite(value)) throw apiError("INVALID_ARGUMENT", "数字无效");
  if (Array.isArray(setting.enum) && !setting.enum.some((option) => (isObject(option) ? option.value : option) === value)) throw apiError("INVALID_ARGUMENT", "设置选项无效");
}
