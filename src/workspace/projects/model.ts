import { isShellProfileId } from "../../terminal/contracts";
import type { ProjectWorkspace, RecentProject } from "../contracts";
import { pathKey } from "../path";
import { MAX_CATALOG_BYTES, MAX_PROJECTS, type ProjectCatalog, type ProjectProfile } from "./contracts";
import { validateEnvironment, validateStartupCommand } from "./environment";

export function createProfile(project: ProjectWorkspace): ProjectProfile {
  return { id: crypto.randomUUID(), project: { ...project }, favorite: false, group: "", shell: "system-default", command: "", env: {} };
}

export function findProfile(catalog: ProjectCatalog, root: string) {
  return catalog.entries.find((entry) => pathKey(entry.project.rootPath) === pathKey(root));
}

export function updateProfile(catalog: ProjectCatalog, profile: ProjectProfile): ProjectCatalog {
  const key = pathKey(profile.project.rootPath);
  if (catalog.entries.some((entry) => entry.id !== profile.id && pathKey(entry.project.rootPath) === key)) {
    throw new Error("这个目录已保存，请编辑已有项目");
  }
  const entries = catalog.entries.filter((entry) => entry.id !== profile.id);
  return parseCatalog(JSON.stringify({ version: 1, entries: [...entries, profile] }));
}

export function parseCatalog(raw: string): ProjectCatalog {
  if (new TextEncoder().encode(raw).byteLength > MAX_CATALOG_BYTES) throw new Error("项目存档过大");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1) throw new Error("项目存档版本不受支持");
  if (!Array.isArray(value.entries) || value.entries.length > MAX_PROJECTS) throw new Error("项目数量或格式无效");
  const entries = value.entries.map(parseProfile);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length
    || new Set(entries.map((entry) => pathKey(entry.project.rootPath))).size !== entries.length) {
    throw new Error("项目存档含有重复记录");
  }
  return { version: 1, entries };
}

function parseProfile(value: unknown): ProjectProfile {
  if (!record(value) || !record(value.project) || typeof value.favorite !== "boolean"
    || typeof value.shell !== "string" || !isShellProfileId(value.shell)) throw new Error("项目配置无效");
  const project = {
    id: text(value.project.id, 512), name: text(value.project.name, 200),
    rootPath: text(value.project.rootPath, 4096), rootUri: text(value.project.rootUri, 16384),
  };
  if (!/^(\/|[A-Za-z]:[\\/])/.test(project.rootPath) && !project.rootPath.startsWith("\\\\")) throw new Error("项目目录必须是绝对路径");
  if (!project.rootUri.startsWith("file://")) throw new Error("项目必须是本地目录");
  return { id: text(value.id, 128), project, favorite: value.favorite, group: text(value.group, 80, true),
    shell: value.shell, command: validateStartupCommand(value.command), env: validateEnvironment(value.env) };
}

function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("项目字段为空、过长或含有无效字符");
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function favoriteGroups(catalog: ProjectCatalog) {
  const groups = new Map<string, ProjectProfile[]>();
  for (const entry of catalog.entries.filter((entry) => entry.favorite)) {
    const group = entry.group.trim() || "收藏";
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right, "zh-CN"));
}

export function unpinnedRecent(catalog: ProjectCatalog, recent: RecentProject[]) {
  return recent.filter((project) => !findProfile(catalog, project.rootPath)?.favorite);
}
