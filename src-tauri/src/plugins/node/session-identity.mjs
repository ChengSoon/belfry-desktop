import { constants } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isPrimaryCodexSession } from "./session-context.mjs";

const MAX_SNAPSHOTS = 512, MAX_SNAPSHOT_BYTES = 1024 * 1024, MAX_SCAN_BYTES = 64 * 1024 * 1024;
const snapshotName = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\.\d+)?\.(?:sh|ps1)$/i;
const cache = new Map();

/** 只读取字面量赋值，绝不执行包含别名/函数/环境变量的 Shell 快照。 */
export function snapshotTabId(text) {
  const ids = new Set();
  for (const line of text.split(/\r?\n/)) {
    const assignment = /^(?:export|declare -x|typeset -x) BELFRY_TAB_ID=(.*)$/.exec(line)
      ?? /^\$env:BELFRY_TAB_ID\s*=\s*(.*)$/i.exec(line);
    if (!assignment) continue;
    const literal = /^(?:'([a-zA-Z0-9_-]{1,128})'|"([a-zA-Z0-9_-]{1,128})"|([a-zA-Z0-9_-]{1,128}))\s*$/.exec(assignment[1]);
    if (!literal) return null;
    ids.add(literal[1] ?? literal[2] ?? literal[3]);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

/** 精确标签 + 同项目 CLI 主会话 + 唯一候选；不按时间猜“最近对话”。 */
export async function resolveSnapshotIdentity(context) {
  if (context.agentKind !== "codex" || !context.historyRoot || !/^[a-zA-Z0-9_-]{1,128}$/.test(context.tabId ?? "")) return null;
  try {
    const root = await realpath(join(dirname(context.historyRoot), "shell_snapshots"));
    const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile() && snapshotName.test(entry.name));
    if (entries.length > MAX_SNAPSHOTS) return null;
    const matches = new Set(); let remaining = MAX_SCAN_BYTES;
    for (const entry of entries) {
      const path = join(root, entry.name), meta = await stat(path);
      if (meta.size > MAX_SNAPSHOT_BYTES) return null;
      const signature = `${meta.dev}:${meta.ino}:${meta.mtimeMs}:${meta.ctimeMs}:${meta.size}`;
      let cached = cache.get(path);
      if (cached?.signature !== signature) {
        remaining -= meta.size;
        if (remaining < 0) return null;
        const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const current = await handle.stat();
          if (!current.isFile() || current.size !== meta.size || current.ino !== meta.ino || current.mtimeMs !== meta.mtimeMs) return null;
          const bytes = Buffer.alloc(meta.size);
          let total = 0;
          while (total < bytes.length) {
            const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
            if (!bytesRead) break;
            total += bytesRead;
          }
          const finished = await handle.stat();
          if (total !== meta.size || finished.size !== meta.size || finished.mtimeMs !== meta.mtimeMs) return null;
          cached = { signature, tabId: snapshotTabId(bytes.toString("utf8")) };
          if (cache.size >= MAX_SNAPSHOTS) cache.delete(cache.keys().next().value);
          cache.set(path, cached);
        } finally { await handle.close(); }
      }
      if (cached.tabId === context.tabId) matches.add(snapshotName.exec(entry.name)[1]);
    }
    let identity = null;
    for (const id of matches) {
      const primary = await isPrimaryCodexSession(context, id);
      if (primary === null) return null;
      if (!primary) continue;
      if (identity) return null;
      identity = { agent: "codex", id };
    }
    return identity;
  } catch { return null; }
}
