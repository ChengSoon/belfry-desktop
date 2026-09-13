import type { LayoutNode } from "../../layout/contracts";
import { MIN_RATIO } from "../../layout/tree";
import { MAX_COLLECTION_BYTES, MAX_COLLECTION_TABS, MAX_LAYOUT_DEPTH, MAX_WORKSPACE_NAME, MAX_WORKSPACES,
  type NamedWorkspace, type WorkspaceCollection } from "./contracts";

export function workspaceName(value: unknown) {
  if (typeof value !== "string") throw new Error("工作区名称无效");
  const name = value.trim();
  if (!name || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error("名称不能为空或包含控制字符");
  if ([...name].length > MAX_WORKSPACE_NAME) throw new Error(`名称最多 ${MAX_WORKSPACE_NAME} 个字符`);
  return name;
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    && !/[\u0000-\u0020\u007f]/u.test(value);
}

export function assertArchiveSize(raw: string) {
  if (raw.length > MAX_COLLECTION_BYTES || new TextEncoder().encode(raw).length > MAX_COLLECTION_BYTES) {
    throw new Error("工作区存档超过 1 MiB 上限");
  }
}

export function parseCollection(raw: string): WorkspaceCollection {
  assertArchiveSize(raw);
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1) throw new Error("工作区存档版本不支持");
  if (!Array.isArray(value.workspaces) || !value.workspaces.length || value.workspaces.length > MAX_WORKSPACES) {
    throw new Error(`工作区数量须在 1–${MAX_WORKSPACES} 之间`);
  }
  const workspaces = value.workspaces.map(parseWorkspace);
  assertUnique(workspaces.map((item) => item.id), "工作区 ID 重复");
  assertUnique(workspaces.map((item) => item.name.toLowerCase()), "工作区名称重复");
  const tabIds = workspaces.flatMap((item) => item.tabIds);
  if (tabIds.length > MAX_COLLECTION_TABS) throw new Error("会话数量超过存档上限");
  assertUnique(tabIds, "同一会话不能归属多个工作区");
  if (!workspaces.some((item) => item.id === value.activeWorkspaceId)) throw new Error("当前工作区引用无效");
  const activeWorkspaceId = value.activeWorkspaceId as string;
  return { version: 1, activeWorkspaceId, workspaces };
}

function parseWorkspace(value: unknown): NamedWorkspace {
  if (!record(value) || !isId(value.id)) throw new Error("工作区 ID 无效");
  if (!Array.isArray(value.tabIds) || value.tabIds.length > MAX_COLLECTION_TABS || !value.tabIds.every(isId)) {
    throw new Error("工作区会话列表无效");
  }
  assertUnique(value.tabIds, "工作区包含重复会话");
  const tabIds = value.tabIds as string[];
  return {
    id: value.id, name: workspaceName(value.name), tabIds,
    activeTabId: isId(value.activeTabId) ? value.activeTabId : null,
    layout: parseLayout(value.layout, new Set(tabIds)),
  };
}

export function parseLayout(value: unknown, allowed: ReadonlySet<string>): LayoutNode | null {
  if (value === null) return null;
  return readLayout(value, { allowed, seen: new Set() }, 0);
}

function readLayout(value: unknown, context: { allowed: ReadonlySet<string>; seen: Set<string> }, depth: number): LayoutNode {
  if (depth > MAX_LAYOUT_DEPTH || !record(value)) throw new Error("工作区布局过深或格式无效");
  if (value.kind === "leaf") {
    if (!isId(value.tabId) || !context.allowed.has(value.tabId)) throw new Error("布局引用了工作区之外的会话");
    if (context.seen.has(value.tabId)) throw new Error("工作区布局包含重复窗格");
    context.seen.add(value.tabId);
    return { kind: "leaf", tabId: value.tabId };
  }
  assertSplit(value);
  return { kind: "split", direction: value.direction, ratio: value.ratio,
    first: readLayout(value.first, context, depth + 1), second: readLayout(value.second, context, depth + 1) };
}

function assertSplit(value: Record<string, unknown>): asserts value is Record<string, unknown> & {
  direction: "row" | "column"; ratio: number;
} {
  if (value.kind !== "split" || (value.direction !== "row" && value.direction !== "column")) {
    throw new Error("工作区分屏方向无效");
  }
  if (typeof value.ratio !== "number" || !Number.isFinite(value.ratio)
    || value.ratio < MIN_RATIO || value.ratio > 1 - MIN_RATIO) throw new Error("工作区分屏比例无效");
}

function assertUnique(values: string[], message: string) {
  if (new Set(values).size !== values.length) throw new Error(message);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
