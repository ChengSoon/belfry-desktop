import type { SshTarget } from "../../terminal/contracts";
import { MAX_HOSTS, MAX_HOSTS_BYTES, MAX_REMOTE_PATH, type HostCatalog, type HostProfile } from "./contracts";

export function parseRemotePath(value: string): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.length > MAX_REMOTE_PATH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("远端目录需为绝对 POSIX 路径，例如 /home/me/project，且不能包含控制字符");
  }
  return value;
}

export function cleanTarget(value: unknown): SshTarget {
  if (!record(value)) throw new Error("SSH 目标无效");
  const host = text(value.host, 255, "主机");
  const user = value.user == null || value.user === "" ? null : text(value.user, 255, "用户名");
  if (/\s|[\u0000-\u001f\u007f/\\]/.test(host) || host.startsWith("-")) throw new Error("主机名不合法");
  if (user && (/\s|[\u0000-\u001f\u007f@]/.test(user) || user.startsWith("-"))) throw new Error("用户名不合法");
  const port = value.port == null || value.port === "" ? null : Number(value.port);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65_535)) throw new Error("端口需在 1–65535 之间");
  const remotePath = value.remotePath == null ? null : typeof value.remotePath === "string"
    ? parseRemotePath(value.remotePath) : invalidPath();
  return { host, user, port, ...(remotePath ? { remotePath } : {}) };
}

export function parseHostCatalog(raw: string): HostCatalog {
  if (raw.length > MAX_HOSTS_BYTES) throw new Error("SSH 主机档案过大");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1) throw new Error("SSH 主机档案版本不受支持");
  if (!Array.isArray(value.entries) || value.entries.length > MAX_HOSTS) throw new Error("SSH 主机列表无效或超出上限");
  const entries = value.entries.map(parseHost), ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error("SSH 主机档案包含重复身份");
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
  if (!record(value)) throw new Error("SSH 主机档案无效");
  return { id: text(value.id, 100, "档案身份"), name: text(value.name, 100, "档案名称"),
    group: value.group === "" || value.group == null ? "" : text(value.group, 80, "分组"), target: cleanTarget(value.target) };
}
function text(value: unknown, limit: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label}无效或过长`);
  }
  return value.trim();
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function invalidPath(): never { throw new Error("远端目录无效"); }
