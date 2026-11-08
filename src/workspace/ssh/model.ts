import { TranslationError, t } from "../../i18n";
import type { SshTarget } from "../../terminal/contracts";
import { MAX_HOSTS, MAX_HOSTS_BYTES, MAX_REMOTE_PATH, type HostCatalog, type HostProfile } from "./contracts";

export function parseRemotePath(value: string): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.length > MAX_REMOTE_PATH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TranslationError("workspace.model.text_ac2fe6b07f");
  }
  return value;
}

export function cleanTarget(value: unknown): SshTarget {
  if (!record(value)) throw new TranslationError("workspace.model.text_fb39c7fc2b");
  const host = text(value.host, 255, t("workspace.model.text_e87d9f23a3"));
  const user = value.user == null || value.user === "" ? null : text(value.user, 255, t("workspace.model.text_1a3f0617d6"));
  if (/\s|[\u0000-\u001f\u007f/\\]/.test(host) || host.startsWith("-")) throw new TranslationError("workspace.model.text_f954f9ce58");
  if (user && (/\s|[\u0000-\u001f\u007f@]/.test(user) || user.startsWith("-"))) throw new TranslationError("workspace.model.text_6036ad0df9");
  const port = value.port == null || value.port === "" ? null : Number(value.port);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65_535)) throw new TranslationError("workspace.model.text_924296682c");
  const remotePath = value.remotePath == null ? null : typeof value.remotePath === "string"
    ? parseRemotePath(value.remotePath) : invalidPath();
  return { host, user, port, ...(remotePath ? { remotePath } : {}) };
}

export function parseHostCatalog(raw: string): HostCatalog {
  if (raw.length > MAX_HOSTS_BYTES) throw new TranslationError("workspace.model.text_00bfb2062a");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1) throw new TranslationError("workspace.model.text_bca9f69b00");
  if (!Array.isArray(value.entries) || value.entries.length > MAX_HOSTS) throw new TranslationError("workspace.model.text_985f23364d");
  const entries = value.entries.map(parseHost), ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new TranslationError("workspace.model.text_02ed9db617");
    ids.add(entry.id);
  }
  return { version: 1, entries };
}

export function saveHost(catalog: HostCatalog, host: HostProfile): HostCatalog {
  const entries = catalog.entries.some((entry) => entry.id === host.id)
    ? catalog.entries.map((entry) => entry.id === host.id ? host : entry) : [...catalog.entries, host];
  return parseHostCatalog(JSON.stringify({ version: 1, entries }));
}

function parseHost(value: unknown): HostProfile {
  if (!record(value)) throw new TranslationError("workspace.model.text_4bc245c0ab");
  return { id: text(value.id, 100, t("workspace.model.text_1cf64c5c57")), name: text(value.name, 100, t("workspace.model.text_af0d8d96ae")),
    group: value.group === "" || value.group == null ? "" : text(value.group, 80, t("workspace.model.text_399ee69347")), target: cleanTarget(value.target) };
}
function text(value: unknown, limit: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TranslationError("workspace.model.text_e6fca394c6", { label: label });
  }
  return value.trim();
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function invalidPath(): never { throw new TranslationError("workspace.model.text_689f3efc47"); }
