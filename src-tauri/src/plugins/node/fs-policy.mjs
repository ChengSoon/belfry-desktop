import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { apiError, permission } from "./errors.mjs";

const PROTECTED = /^(?:\.git|\.ssh|\.aws|\.config|\.codex|\.claude|node_modules|\.env(?:\..*)?|credentials(?:\..*)?|id_rsa|id_ed25519)$/i;
export const FILE_LIMIT = 2 * 1024 * 1024;
export function matches(pattern, input, separator = "/") {
  const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = pattern.split(separator).map((part, index, all) => {
    if (part === "**") return index === all.length - 1 ? ".*" : `(?:[^${escape(separator)}]+${escape(separator)})*`;
    return part.split("*").map(escape).join(`[^${escape(separator)}]*`) + (index < all.length - 1 ? escape(separator) : "");
  });
  return new RegExp(`^${parts.join("")}$`).test(input);
}
export function cleanPath(value, directory = false) {
  if (directory && ["", "."].includes(value)) return "";
  if (typeof value !== "string" || !value || /[\\:\x00-\x1f<>"|]/.test(value)) throw apiError("INVALID_ARGUMENT", "文件路径无效");
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part) || PROTECTED.test(part))) {
    throw apiError("PERMISSION_DENIED", "文件路径越界或属于受保护目录/文件");
  }
  return value;
}
export function withinScope(entry, mode, path) {
  const rule = entry.manifest.fs?.[mode];
  if (!rule) return entry.manifest.permissions?.includes(`fs.${mode}.workspace`) ?? false;
  if (rule.root === "userSelected" && !rule.scope?.length) return true;
  return (rule.scope ?? []).some((pattern) => matches(pattern, path));
}
export async function filePath(entry, input) {
  const { mode, context, directory = false, create = false } = input;
  permission(entry, `fs.${mode}`);
  const path = cleanPath(input.path, directory);
  if (!directory && !withinScope(entry, mode, path)) throw apiError("PERMISSION_DENIED", "文件不在声明范围内");
  const rule = entry.manifest.fs?.[mode];
  const root = rule?.root === "userSelected" ? entry.directoryGrant : context.workspace;
  if (!root) throw apiError("NO_WORKSPACE", "请先打开项目或选择授权目录");
  let target = await realpath(root);
  const parts = path ? path.split("/") : [];
  for (const [index, part] of parts.entries()) {
    target = join(target, part);
    const last = index === parts.length - 1;
    await checkSegment(target, { create, last });
  }
  return target;
}
async function checkSegment(target, { create, last }) {
  let meta = await lstat(target).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
  if (!meta) {
    if (!create) throw apiError("NOT_FOUND", "文件不存在");
    if (last) return;
    await mkdir(target); meta = await lstat(target);
  }
  if (meta.isSymbolicLink() || (!last && !meta.isDirectory())) throw apiError("PERMISSION_DENIED", "拒绝链接或无效目录");
}
