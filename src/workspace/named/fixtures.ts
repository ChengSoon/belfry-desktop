import type { LayoutNode } from "../../layout/contracts";
import type { WorkspaceCollection } from "./contracts";

export const threePanes: LayoutNode = {
  kind: "split", direction: "row", ratio: 0.3,
  first: { kind: "leaf", tabId: "a" },
  second: {
    kind: "split", direction: "column", ratio: 0.65,
    first: { kind: "leaf", tabId: "b" }, second: { kind: "leaf", tabId: "c" },
  },
};

export function fixtureCollection(): WorkspaceCollection {
  return {
    version: 1, activeWorkspaceId: "one",
    workspaces: [
      { id: "one", name: "开发", tabIds: ["a", "b", "c", "d"], activeTabId: "b", layout: threePanes },
      { id: "two", name: "文档", tabIds: ["e"], activeTabId: "e", layout: null },
      { id: "empty", name: "新项目", tabIds: [], activeTabId: null, layout: null },
    ],
  };
}

export function memoryStorage(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set("belfry.named-workspaces.v1", initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}
