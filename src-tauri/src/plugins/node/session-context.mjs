import { constants } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { apiError } from "./errors.mjs";
import { Transcript } from "./session-transcript.mjs";

const HEAD_BYTES = 64 * 1024, TAIL_BYTES = 2 * 1024 * 1024, MAX_FILES = 8, MAX_ENTRIES = 20_000;
const unavailable = () => apiError("UNAVAILABLE", "当前 CLI 尚未提供可核验的会话上下文，请继续当前会话后重试");
function validId(id) { return typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id); }
export function bindToolContext(context, request) {
  if (context.agentKind !== "codex" || request.method !== "tools/call") return context;
  // 已核对 codex-cli 0.153.4：core/src/mcp_tool_call.rs 在每次 tools/call 的 _meta 中加入 threadId。
  const id = request.params?._meta?.threadId;
  if (id === undefined) return context;
  if (!validId(id)) throw apiError("INVALID_ARGUMENT", "CLI 会话标识无效");
  if (context.agentSession && context.agentSession.id !== id) throw apiError("SESSION_MISMATCH", "MCP 连接与 CLI 会话不匹配");
  context.agentSession ??= { agent: "codex", id };
  return context;
}
async function candidates(root, session) {
  const queue = [{ path: root, depth: 0 }], files = []; let visited = 0;
  while (queue.length) {
    const item = queue.shift();
    for (const entry of await readdir(item.path, { withFileTypes: true })) {
      if (++visited > MAX_ENTRIES) throw apiError("LIMIT_EXCEEDED", "会话目录条目过多，无法在限定范围内读取");
      const path = join(item.path, entry.name);
      if (entry.isDirectory() && item.depth < 8) queue.push({ path, depth: item.depth + 1 });
      const matches = session.agent === "codex" ? entry.name.endsWith(`-${session.id}.jsonl`) : entry.name === `${session.id}.jsonl`;
      if (entry.isFile() && matches) files.push(path);
    }
  }
  return files.sort();
}
async function readBytes(handle, offset, size) {
  const bytes = Buffer.alloc(size); let total = 0;
  while (total < size) {
    const { bytesRead } = await handle.read(bytes, total, size - total, offset + total);
    if (!bytesRead) break; total += bytesRead;
  }
  return bytes.subarray(0, total);
}
function records(bytes, partialStart = false) {
  let source = bytes.toString("utf8");
  if (partialStart) source = source.slice(source.indexOf("\n") + 1);
  const end = source.lastIndexOf("\n");
  return (end < 0 ? [] : source.slice(0, end).split("\n")).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}
function metadata(lines, session) {
  if (session.agent === "codex") {
    const meta = lines.find((line) => line.type === "session_meta")?.payload;
    return meta && (meta.id ?? meta.session_id) === session.id ? meta : null;
  }
  return lines.find((line) => line.sessionId === session.id && typeof line.cwd === "string") ?? null;
}
async function readFile(path, scope) {
  const full = await realpath(path), location = relative(scope.root, full);
  if (isAbsolute(location) || location === ".." || location.startsWith(`..${sep}`)) return null;
  const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const meta = await handle.stat(); if (!meta.isFile()) return null;
    const head = records(await readBytes(handle, 0, Math.min(meta.size, HEAD_BYTES)));
    const info = metadata(head, scope.session);
    if (!info?.cwd || await realpath(info.cwd).catch(() => null) !== scope.workspace) return null;
    const offset = Math.max(0, meta.size - TAIL_BYTES);
    const tail = await readBytes(handle, offset, Math.min(meta.size, TAIL_BYTES));
    return { lines: records(tail, offset > 0), truncated: offset > 0, meta: info };
  } finally { await handle.close(); }
}
export async function readSessionContext(context, stripName, resolveModel) {
  const scope = await sessionScope(context), session = scope.session;
  const files = await candidates(scope.root, session), transcript = new Transcript(stripName); let found = false;
  transcript.truncated = files.length > MAX_FILES;
  for (const path of files.slice(-MAX_FILES)) {
    const file = await readFile(path, scope); if (!file) continue;
    found = true; transcript.truncated ||= file.truncated;
    for (const line of file.lines) session.agent === "codex" ? transcript.codex(line) : transcript.claude(line, session.id);
  }
  if (!found) throw unavailable();
  return { sessionId: session.id, modelKey: context.modelKey ?? (resolveModel && transcript.modelId ? await resolveModel(transcript.modelId) : null),
    thinkingLevel: transcript.thinkingLevel, messages: transcript.messages, truncated: transcript.truncated };
}
async function sessionScope(context) {
  const session = context.agentSession;
  if (!session || !["codex", "claude"].includes(session.agent) || !validId(session.id) || !context.historyRoot || !context.workspace) throw unavailable();
  return { session, root: await realpath(context.historyRoot).catch(() => { throw unavailable(); }), workspace: await realpath(context.workspace) };
}
