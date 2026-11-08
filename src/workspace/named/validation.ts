import { TranslationError, t } from "../../i18n";
import type { LayoutNode } from "../../layout/contracts";
import { MIN_RATIO } from "../../layout/tree";
import { MAX_COLLECTION_BYTES, MAX_COLLECTION_TABS, MAX_LAYOUT_DEPTH, MAX_WORKSPACE_NAME, MAX_WORKSPACES,
  type NamedWorkspace, type WorkspaceCollection } from "./contracts";

export function workspaceName(value: unknown) {
  if (typeof value !== "string") throw new TranslationError("workspace.validation.text_24de513da2");
  const name = value.trim();
  if (!name || /[\u0000-\u001f\u007f]/u.test(name)) throw new TranslationError("workspace.validation.text_6cb48bf81b");
  if ([...name].length > MAX_WORKSPACE_NAME) throw new TranslationError("workspace.validation.text_f01ea43b86", { max: MAX_WORKSPACE_NAME });
  return name;
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    && !/[\u0000-\u0020\u007f]/u.test(value);
}

export function assertArchiveSize(raw: string) {
  if (raw.length > MAX_COLLECTION_BYTES || new TextEncoder().encode(raw).length > MAX_COLLECTION_BYTES) {
    throw new TranslationError("workspace.validation.text_38272997e3");
  }
}

export function parseCollection(raw: string): WorkspaceCollection {
  assertArchiveSize(raw);
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1) throw new TranslationError("workspace.validation.text_cbc5b2222f");
  if (!Array.isArray(value.workspaces) || !value.workspaces.length || value.workspaces.length > MAX_WORKSPACES) {
    throw new TranslationError("workspace.validation.text_4634a9766a", { max: MAX_WORKSPACES });
  }
  const workspaces = value.workspaces.map(parseWorkspace);
  assertUnique(workspaces.map((item) => item.id), t("workspace.validation.text_f9b8258181"));
  assertUnique(workspaces.map((item) => item.name.toLowerCase()), t("workspace.validation.text_ad97d3fb34"));
  const tabIds = workspaces.flatMap((item) => item.tabIds);
  if (tabIds.length > MAX_COLLECTION_TABS) throw new TranslationError("workspace.validation.text_4fe282886f");
  assertUnique(tabIds, t("workspace.validation.text_4a519514a9"));
  if (!workspaces.some((item) => item.id === value.activeWorkspaceId)) throw new TranslationError("workspace.validation.text_4eaee2bef2");
  const activeWorkspaceId = value.activeWorkspaceId as string;
  return { version: 1, activeWorkspaceId, workspaces };
}

function parseWorkspace(value: unknown): NamedWorkspace {
  if (!record(value) || !isId(value.id)) throw new TranslationError("workspace.validation.text_b9b9a1fddc");
  if (!Array.isArray(value.tabIds) || value.tabIds.length > MAX_COLLECTION_TABS || !value.tabIds.every(isId)) {
    throw new TranslationError("workspace.validation.text_699f36bb42");
  }
  assertUnique(value.tabIds, t("workspace.validation.text_e96dd6bc5c"));
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
  if (depth > MAX_LAYOUT_DEPTH || !record(value)) throw new TranslationError("workspace.validation.text_65742cf8e0");
  if (value.kind === "leaf") {
    if (!isId(value.tabId) || !context.allowed.has(value.tabId)) throw new TranslationError("workspace.validation.text_605b5e44ef");
    if (context.seen.has(value.tabId)) throw new TranslationError("workspace.validation.text_c1a65484b6");
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
    throw new TranslationError("workspace.validation.text_da757026b2");
  }
  if (typeof value.ratio !== "number" || !Number.isFinite(value.ratio)
    || value.ratio < MIN_RATIO || value.ratio > 1 - MIN_RATIO) throw new TranslationError("workspace.validation.text_412b1cd4d7");
}

function assertUnique(values: string[], message: string) {
  if (new Set(values).size !== values.length) throw new Error(message);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
