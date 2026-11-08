import { errorMessage as localizedErrorMessage } from "../../i18n";
import { TranslationError } from "../../i18n";
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
    return { catalog: { version: 1, entries: [] }, raw, get error() { return errorMessage(error); } };
  }
}

export function readProjectCatalog() {
  const result = loadProjectCatalog();
  if (result.error) throw new TranslationError("workspace.storage.text_56b3b7dd8a", { error: result.error });
  return result.catalog;
}

export function saveProjectCatalog(catalog: ProjectCatalog, options: SaveOptions) {
  const storage = options.storage ?? localStorage;
  const raw = JSON.stringify(parseCatalog(JSON.stringify(catalog)));
  if (storage.getItem(PROJECT_CATALOG_KEY) !== options.expectedRaw) throw new TranslationError("workspace.storage.text_698ae97e57");
  if (options.expectedRaw !== null) parseCatalog(options.expectedRaw);
  storage.setItem(PROJECT_CATALOG_KEY, raw);
  if (storage.getItem(PROJECT_CATALOG_KEY) !== raw) throw new TranslationError("workspace.storage.text_696a80c376");
  if (!options.storage) window.dispatchEvent(new Event(PROJECT_CATALOG_EVENT));
  return raw;
}

export function errorMessage(error: unknown) { return localizedErrorMessage(error); }
