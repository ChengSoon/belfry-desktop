import type { AgentKind, AgentSessionRef } from "../agent/contracts";

/**
 * 共享上下文：多个 Agent 会话之间互通的那点东西。
 *
 * 有意避开 localStorage：这里的消费者不只是 UI，更是 Agent 自己——它读得到文件，
 * 进不了浏览器存储。所以正文落在 `<project>/.belfry/context/` 下，前端只拿索引。
 *
 * 这一层对「是哪个 Agent」保持无知：不比较 agent 取值，只读能力。新接一个 CLI
 * 进来时，这个文件不该有任何改动。
 */

/**
 * 一条上下文的来路。
 *
 * 记来路不是为了好看：同一段文字，是用户手敲的、还是从某个会话屏幕上抓的，
 * 可信度差很多，UI 要能把这个差别显示出来。
 */
export type ContextSource =
  | { from: "user" }
  | { from: "terminal"; tabId: string }
  | { from: "agent"; tabId: string; agent: AgentKind }
  | { from: "history"; session: AgentSessionRef };

/**
 * 内容形态。
 *
 * - `note` 用户手写的约定、决策
 * - `excerpt` 从终端屏幕上截的片段
 * - `artifact` 某一步跑出来的产物（通常是文件）
 * - `digest` 从 CLI 自己的会话日志里提炼的摘要
 */
export type ContextKind = "note" | "excerpt" | "artifact" | "digest";

export interface ContextItem {
  id: string;
  kind: ContextKind;
  title: string;
  /** 短内容直接内联。长内容留 null，正文在 `path` 指的文件里。 */
  body: string | null;
  /** 相对项目根的路径。和 `body` 至少有一个不为 null。 */
  path: string | null;
  source: ContextSource;
  tags: string[];
  /** 置顶项会自动带进新会话的开场白，代价是每次都吃 token，所以默认关。 */
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export const CONTEXT_TITLE_MAX = 80;
export const CONTEXT_TAGS_MAX = 8;
export const CONTEXT_ITEMS_MAX = 200;

/**
 * 超过这个长度就落盘，不再内联。
 *
 * 阈值卡在这里是为了 token：把几千字内联进每一条 prompt，成本会失控，而让 Agent
 * 自己读文件是它最擅长的事。短内容内联则省掉一次工具调用的往返。
 */
export const CONTEXT_INLINE_MAX = 1200;

/** 单条正文的硬上限，挡住把整个日志文件塞进来的操作。 */
export const CONTEXT_BODY_MAX = 256 * 1024;

export function shouldInline(body: string) {
  return body.length <= CONTEXT_INLINE_MAX;
}

/**
 * 拼给 Agent 看的引用。
 *
 * 默认给路径而不是正文——所有 coding agent 都会读文件，让它自己去读比我们塞过去
 * 更省 token，也不会因为内容长就撑爆 prompt。只有内联项才直接给正文。
 */
export function contextReference(item: ContextItem): string {
  if (item.path) return `@${item.path}`;
  const body = item.body ?? "";
  return `【${item.title}】\n${body}`;
}

export function createContextItem(
  input: {
    kind: ContextKind;
    title: string;
    body: string;
    source: ContextSource;
    tags?: readonly string[];
  },
  now = Date.now(),
): ContextItem {
  const inline = shouldInline(input.body);
  return {
    id: crypto.randomUUID(),
    kind: input.kind,
    title: normalizeTitle(input.title, input.body),
    body: inline ? input.body : null,
    path: null,
    source: input.source,
    tags: normalizeTags(input.tags ?? []),
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** 标题留空时从正文首行兜一个，空标题的条目在列表里没法认。 */
export function normalizeTitle(title: string, body = "") {
  const trimmed = title.trim();
  const fallback = body.replace(/\s+/gu, " ").trim();
  const picked = trimmed.length > 0 ? trimmed : fallback;
  if (picked.length === 0) return "未命名";
  return picked.length <= CONTEXT_TITLE_MAX
    ? picked
    : `${picked.slice(0, CONTEXT_TITLE_MAX - 1)}…`;
}

export function normalizeTags(tags: readonly string[]) {
  const seen: string[] = [];
  for (const tag of tags) {
    const value = tag.trim();
    if (value.length === 0 || seen.includes(value)) continue;
    seen.push(value);
    if (seen.length >= CONTEXT_TAGS_MAX) break;
  }
  return seen;
}

export function isContextKind(value: unknown): value is ContextKind {
  return value === "note" || value === "excerpt" || value === "artifact" || value === "digest";
}

export function isContextSource(value: unknown): value is ContextSource {
  if (!isRecord(value)) return false;
  switch (value.from) {
    case "user":
      return true;
    case "terminal":
      return isNonEmptyString(value.tabId);
    case "agent":
      return isNonEmptyString(value.tabId) && isNonEmptyString(value.agent);
    case "history":
      return isRecord(value.session)
        && isNonEmptyString(value.session.agent)
        && isNonEmptyString(value.session.id);
    default:
      return false;
  }
}

/**
 * 逐字段校验一条。
 *
 * 和 Recipe 的存档一个路子：坏掉的单条丢弃，不让一条脏数据废掉整份索引——
 * 这份文件是 Agent 也能写的，格式出错的概率比纯 UI 写入高得多。
 */
export function parseContextItem(value: unknown): ContextItem | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id) || !isContextKind(value.kind)) return null;
  if (!isContextSource(value.source)) return null;

  const body = typeof value.body === "string" ? value.body : null;
  const path = typeof value.path === "string" && value.path.trim().length > 0
    ? value.path
    : null;
  // 正文和路径全空的条目没有任何内容可给，留着只会在引用时产生空串。
  if (body === null && path === null) return null;
  if (body !== null && body.length > CONTEXT_BODY_MAX) return null;

  const createdAt = isFiniteNumber(value.createdAt) ? value.createdAt : Date.now();
  return {
    id: value.id,
    kind: value.kind,
    title: normalizeTitle(typeof value.title === "string" ? value.title : "", body ?? ""),
    body,
    path,
    source: value.source,
    tags: normalizeTags(Array.isArray(value.tags) ? value.tags.filter(isNonEmptyString) : []),
    pinned: value.pinned === true,
    createdAt,
    updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : createdAt,
  };
}

export function parseContextItems(value: unknown): ContextItem[] {
  if (!Array.isArray(value)) return [];
  const items: ContextItem[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const item = parseContextItem(entry);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length >= CONTEXT_ITEMS_MAX) break;
  }
  return items;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
