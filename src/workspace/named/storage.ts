import { NAMED_RECOVERY_KEY, NAMED_WORKSPACES_KEY, type CollectionLoad, type WorkspaceCollection, type WorkspaceSeed } from "./contracts";
import { initialCollection, reconcileCollection } from "./model";
import { parseCollection } from "./validation";

interface SaveOptions {
  storage?: Pick<Storage, "getItem" | "setItem">;
  expectedRaw: string | null;
}

export function loadNamedWorkspaces(seed: WorkspaceSeed, storage: Pick<Storage, "getItem"> = localStorage): CollectionLoad {
  let raw: string | null = null;
  try {
    raw = storage.getItem(NAMED_WORKSPACES_KEY);
    const initial = raw === null ? initialCollection(seed) : parseCollection(raw);
    const result = reconcileCollection(initial, seed.tabIds);
    return { ...result, raw, error: null };
  } catch (error) {
    return { collection: initialCollection(seed), raw, notices: [], error: message(error) };
  }
}

export function saveNamedWorkspaces(collection: WorkspaceCollection, options: SaveOptions) {
  const storage = options.storage ?? localStorage;
  const raw = JSON.stringify(collection);
  parseCollection(raw);
  assertUnchanged(storage, options.expectedRaw);
  if (raw !== options.expectedRaw) storage.setItem(NAMED_WORKSPACES_KEY, raw);
  if (storage.getItem(NAMED_WORKSPACES_KEY) !== raw) throw new Error("工作区保存后回读不一致，请重试");
  return raw;
}

/** 仅由明确的「备份原存档并保存」操作调用；备份失败时绝不覆盖原内容。 */
export function replaceNamedArchive(collection: WorkspaceCollection, options: SaveOptions) {
  const storage = options.storage ?? localStorage;
  assertUnchanged(storage, options.expectedRaw);
  if (options.expectedRaw !== null) {
    storage.setItem(NAMED_RECOVERY_KEY, options.expectedRaw);
    if (storage.getItem(NAMED_RECOVERY_KEY) !== options.expectedRaw) throw new Error("原工作区存档备份失败");
  }
  return saveNamedWorkspaces(collection, { ...options, storage });
}

function assertUnchanged(storage: Pick<Storage, "getItem">, expected: string | null) {
  if (storage.getItem(NAMED_WORKSPACES_KEY) !== expected) throw new Error("工作区已在其他窗口修改，请先重新读取存档");
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
