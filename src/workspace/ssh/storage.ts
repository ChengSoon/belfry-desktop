import { SSH_HOSTS_EVENT, SSH_HOSTS_KEY, type HostCatalog, type HostLoad } from "./contracts";
import { parseHostCatalog } from "./model";

type Reader = Pick<Storage, "getItem">;
interface SaveOptions { expectedRaw: string | null; storage?: Reader & Pick<Storage, "setItem"> }

export function loadHosts(storage: Reader | undefined = globalThis.localStorage): HostLoad {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SSH_HOSTS_KEY) ?? null;
    return { catalog: raw === null ? { version: 1, entries: [] } : parseHostCatalog(raw), raw, error: null };
  } catch (error) { return { catalog: { version: 1, entries: [] }, raw, error: message(error) }; }
}

export function persistHosts(catalog: HostCatalog, options: SaveOptions) {
  const storage = options.storage ?? localStorage;
  const raw = JSON.stringify(parseHostCatalog(JSON.stringify(catalog)));
  if (storage.getItem(SSH_HOSTS_KEY) !== options.expectedRaw) throw new Error("SSH 主机档案已在其他窗口修改，请重新读取");
  if (options.expectedRaw !== null) parseHostCatalog(options.expectedRaw);
  storage.setItem(SSH_HOSTS_KEY, raw);
  if (storage.getItem(SSH_HOSTS_KEY) !== raw) throw new Error("SSH 档案保存后回读不一致");
  if (!options.storage) window.dispatchEvent(new Event(SSH_HOSTS_EVENT));
  return raw;
}

export function message(error: unknown) {
  return error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
}
