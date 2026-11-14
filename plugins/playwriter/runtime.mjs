import { readFile, mkdir, mkdtemp, rename, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { extractRuntime } from "./runtime-archive.mjs";

export const ENGINE_VERSION = "0.11.0";
async function readMetadata(vendor) {
  let metadata;
  try { metadata = JSON.parse(await readFile(new URL("runtime.json", vendor), "utf8")); }
  catch { throw new Error("缺少 Playwriter 运行组件，请安装完整插件包；源码开发请先执行 node scripts/build-playwriter-plugin.mjs。"); }
  if (metadata.version !== ENGINE_VERSION || !/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error("运行组件版本无效");
  return metadata;
}
export async function prepareRuntime(dataPath, { signal, vendor = new URL("./vendor/", import.meta.url) } = {}) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Playwriter 需要 Node.js 22 或更新版本，请在 Belfry 中切换 Node.js 后重试。");
  const metadata = await readMetadata(vendor);
  const base = join(dataPath, "runtime"), target = join(base, `${ENGINE_VERSION}-${metadata.sha256.slice(0, 16)}`);
  const entry = join(target, "node_modules/playwriter/dist/executor.js");
  const ready = async () => (await readFile(join(target, ".ready"), "utf8").catch(() => "")) === metadata.sha256
    && (await stat(entry).catch(() => null))?.isFile();
  if (await ready()) return target;
  signal?.throwIfAborted();
  const bytes = await readFile(new URL("runtime.zip", vendor));
  if (createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) throw new Error("运行组件包摘要不一致，请重新安装插件。");
  await mkdir(base, { recursive: true });
  const stage = await mkdtemp(join(base, ".preparing-"));
  try {
    const extracted = await extractRuntime(bytes, stage, { signal });
    if (extracted.fileCount !== metadata.fileCount || extracted.totalBytes !== metadata.totalBytes) throw new Error("运行组件内容与清单不一致");
    await writeFile(join(stage, ".ready"), metadata.sha256, { mode: 0o600 });
    try { await rename(stage, target); }
    catch (error) { if (!await ready()) throw error; }
    return target;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

export async function loadEngine(dataPath, options = {}) {
  const root = await prepareRuntime(dataPath, options);
  // Upstream helpers without an explicit output path write to cwd. Each plugin has
  // its own worker process, so keep artifacts out of the watched plugin source.
  const artifacts = join(dataPath, "artifacts");
  await mkdir(artifacts, { recursive: true });
  process.chdir(artifacts);
  // These upstream constants are read at module initialization.
  process.env.PLAYWRITER_TELEMETRY = "0";
  process.env.DO_NOT_TRACK = "1";
  process.env.PLAYWRITER_LOG_FILE_PATH = join(dataPath, "relay.log");
  process.env.PLAYWRITER_CDP_LOG_FILE_PATH = join(dataPath, "cdp.jsonl");
  const moduleUrl = name => pathToFileURL(join(root, "node_modules/playwriter/dist", name)).href;
  const [executor, relay] = await Promise.all([import(moduleUrl("executor.js")), import(moduleUrl("cdp-relay.js"))]);
  return { ...executor, ...relay, root };
}
