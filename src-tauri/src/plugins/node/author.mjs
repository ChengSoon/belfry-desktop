import { lstat, mkdir, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { templateFiles } from "./templates.mjs";
import { validId } from "./manifest.mjs";
import { resourcePath } from "./manifest-values.mjs";
import { readDirectory } from "./directory.mjs";
import { storeZip } from "./zip.mjs";

export async function scaffold({ directory, template, id, name, author }) {
  const target = resolve(directory);
  const existing = await lstat(target).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error("请选择普通空目录");
  if (existing && (await readdir(target)).some((entry) => entry !== ".DS_Store")) throw new Error("目标目录非空，未覆盖已有文件");
  const slug = basename(target).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "") || "plugin";
  id ??= `local.${slug}`;
  if (!validId(id)) throw new Error("插件 ID 无效");
  name = name?.trim() || basename(target);
  const { manifest, files } = templateFiles({ template, id, name, author });
  await mkdir(target, { recursive: true });
  for (const [relative, content] of files) {
    const path = join(target, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: "wx" });
  }
  return { directory: await realpath(target), manifest, files: [...files.keys()] };
}
export async function check(directory) {
  const snapshot = await readDirectory(directory);
  return { ok: true, manifest: snapshot.manifest, fileCount: snapshot.files.size,
    totalBytes: snapshot.totalBytes, digest: snapshot.digest,
    warnings: snapshot.manifest.icon && !snapshot.files.has(resourcePath(snapshot.manifest.icon)) ? ["可选图标 icon 文件不存在，将使用默认图标"] : [] };
}
export async function pack({ directory, out }) {
  const snapshot = await readDirectory(directory);
  const output = resolve(out || join(snapshot.root, "dist"));
  const info = await lstat(output).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (info?.isSymbolicLink() || info && !info.isDirectory()) throw new Error("打包输出必须为普通目录");
  const bytes = storeZip(snapshot.files);
  await mkdir(output, { recursive: true });
  const fileName = `${snapshot.manifest.id}-${snapshot.manifest.version}.piplug`;
  const packagePath = join(output, fileName);
  const temporary = join(output, `.${randomUUID()}.tmp`);
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, packagePath);
  return { packagePath, fileName, byteLength: bytes.length, fileCount: snapshot.files.size,
    sha256: createHash("sha256").update(bytes).digest("hex") };
}
