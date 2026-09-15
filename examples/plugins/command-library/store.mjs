import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { MAX_BYTES, parseLibrary } from "./model.mjs";

export function createStore(dataPath) {
  let queue = Promise.resolve();
  const read = async () => {
    const path = join(await dataPath(), "library.json");
    let raw;
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error("收藏库存档不是普通文件或超过大小上限");
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { document: { version: 1, entries: [] }, revision: "empty" };
      throw error;
    }
    return { document: parseLibrary(raw), revision: digest(raw) };
  };
  const change = (expected, update) => {
    const work = queue.then(async () => {
      const state = await read();
      if (state.revision !== expected) throw new Error("收藏库已发生变化，请重新读取后保存");
      const document = await update(state.document);
      const raw = JSON.stringify(parseLibrary(JSON.stringify(document)), null, 2) + "\n";
      if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error("收藏库存档超过大小上限");
      if ((await read()).revision !== expected) throw new Error("收藏库已发生变化，请重新读取后保存");
      await atomicWrite(await dataPath(), raw);
      const saved = await read();
      if (saved.revision !== digest(raw)) throw new Error("收藏库保存后的内容不一致，请重新读取");
      return saved;
    });
    queue = work.catch(() => {}); return work;
  };
  return { read, change };
}

async function atomicWrite(directory, raw) {
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.library-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600); await handle.writeFile(raw, "utf8"); await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, join(directory, "library.json"));
  } finally { if (handle) await handle.close(); await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}
function digest(raw) { return createHash("sha256").update(raw).digest("hex"); }
