import { PROJECT_CATALOG_EVENT, PROJECT_CATALOG_KEY, type CatalogLoad, type ProjectCatalog } from "./contracts";
import { parseCatalog } from "./model";

type StorageRead = Pick<Storage, "getItem">;
interface SaveOptions { expectedRaw: string | null; storage?: StorageRead & Pick<Storage, "setItem"> }

export function loadProjectCatalog(storage: StorageRead | undefined = globalThis.localStorage): CatalogLoad {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(PROJECT_CATALOG_KEY) ?? null;
    return { catalog: raw === null ? { version: 1, entries: [] } : parseCatalog(raw), raw, error: null };
  } catch (error) {
    return { catalog: { version: 1, entries: [] }, raw, error: errorMessage(error) };
  }
}

export function readProjectCatalog() {
  const result = loadProjectCatalog();
  if (result.error) throw new Error(`项目配置无法读取：${result.error}`);
  return result.catalog;
}

export function saveProjectCatalog(catalog: ProjectCatalog, options: SaveOptions) {
  const storage = options.storage ?? localStorage;
  const raw = JSON.stringify(parseCatalog(JSON.stringify(catalog)));
  if (storage.getItem(PROJECT_CATALOG_KEY) !== options.expectedRaw) throw new Error("项目配置已在其他窗口变化，请重新读取后保存");
  if (options.expectedRaw !== null) parseCatalog(options.expectedRaw);
  storage.setItem(PROJECT_CATALOG_KEY, raw);
  if (storage.getItem(PROJECT_CATALOG_KEY) !== raw) throw new Error("项目保存后回读不一致，请重试");
  if (!options.storage) window.dispatchEvent(new Event(PROJECT_CATALOG_EVENT));
  return raw;
}

export function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return String(error);
}
