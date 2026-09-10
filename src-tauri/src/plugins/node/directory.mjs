import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseJson } from "./json.mjs";
import { resourcePath, resources, validateManifest } from "./manifest.mjs";

export const LIMITS = { files: 2000, entries: 4000, depth: 12, fileBytes: 50 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 };
const IGNORED = new Set([".git", "node_modules", "dist", ".DS_Store", "Thumbs.db"]);
function safeName(path) {
  resourcePath(path);
  for (const name of path.split("/")) {
    if (/[<>"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) {
      throw new Error(`文件路径在 Windows 上无效：${path}`);
    }
  }
}
export async function readDirectory(input) {
  const info = await lstat(input);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("请选择普通插件目录");
  const root = await realpath(input);
  const files = new Map();
  const seen = new Set();
  const state = { entries: 0, totalBytes: 0 };
  async function visit(relative, depth) {
    if (depth > LIMITS.depth) throw new Error("目录层数超额");
    for (const name of (await readdir(join(root, relative))).sort()) {
      if (IGNORED.has(name)) continue;
      const path = relative ? `${relative}/${name}` : name;
      safeName(path);
      if (++state.entries > LIMITS.entries) throw new Error("目录总条目超额");
      if (seen.has(path.toLowerCase())) throw new Error(`文件路径大小写冲突：${path}`);
      seen.add(path.toLowerCase());
      const meta = await lstat(join(root, path));
      if (meta.isSymbolicLink()) throw new Error(`拒绝符号链接：${path}`);
      if (meta.isDirectory()) { await visit(path, depth + 1); continue; }
      await collectFile({ root, files, state }, path, meta);
    }
  }
  await visit("", 0);
  if (!files.has("manifest.json")) throw new Error("根目录缺少 manifest.json");
  if (files.get("manifest.json").length > 1024 * 1024) throw new Error("manifest 大小超额");
  const manifest = validateManifest(parseJson(new TextDecoder("utf-8", { fatal: true }).decode(files.get("manifest.json"))));
  for (const path of resources(manifest)) if (!files.has(path)) throw new Error(`插件资源不存在：${path}`);
  validateContents(manifest, files);
  const hash = createHash("sha256");
  for (const [path, bytes] of files) hash.update(path).update("\0").update(bytes);
  return { root, manifest, files, digest: hash.digest("hex"), ...state };
}
async function collectFile({ root, files, state }, path, meta) {
  if (!meta.isFile() || meta.size > LIMITS.fileBytes || files.size >= LIMITS.files) throw new Error("文件类型或数量/大小超额");
  const bytes = await readFile(join(root, path));
  state.totalBytes += bytes.length;
  if (bytes.length > LIMITS.fileBytes || state.totalBytes > LIMITS.totalBytes) throw new Error("插件文件大小超额");
  files.set(path, bytes);
}
function validateContents(manifest, files) {
  for (const kind of ["skills", "themes"]) for (const item of manifest.contributes?.[kind] ?? []) {
    const path = resourcePath(typeof item === "string" ? item : item.path), bytes = files.get(path);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const limit = (kind === "themes" ? 256 : 64) * 1024;
    if (bytes.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) throw new Error(`${kind} 文件过大或含控制字符`);
  }
}
