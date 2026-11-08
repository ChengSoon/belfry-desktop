import { TranslationError, getLocale, t } from "../../i18n";
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
    throw new TranslationError("workspace.model.text_87944c9a2b");
  }
  const entries = catalog.entries.filter((entry) => entry.id !== profile.id);
  return parseCatalog(JSON.stringify({ version: 1, entries: [...entries, profile] }));
}

export function parseCatalog(raw: string): ProjectCatalog {
  if (new TextEncoder().encode(raw).byteLength > MAX_CATALOG_BYTES) throw new TranslationError("workspace.model.text_298cf392da");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1) throw new TranslationError("workspace.model.text_75411a2e56");
  if (!Array.isArray(value.entries) || value.entries.length > MAX_PROJECTS) throw new TranslationError("workspace.model.text_abe4076b64");
  const entries = value.entries.map(parseProfile);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length
    || new Set(entries.map((entry) => pathKey(entry.project.rootPath))).size !== entries.length) {
    throw new TranslationError("workspace.model.text_82e1df7c39");
  }
  return { version: 1, entries };
}

function parseProfile(value: unknown): ProjectProfile {
  if (!record(value) || !record(value.project) || typeof value.favorite !== "boolean"
    || typeof value.shell !== "string" || !isShellProfileId(value.shell)) throw new TranslationError("workspace.model.text_5f98848f1a");
  const project = {
    id: text(value.project.id, 512), name: text(value.project.name, 200),
    rootPath: text(value.project.rootPath, 4096), rootUri: text(value.project.rootUri, 16384),
  };
  if (!/^(\/|[A-Za-z]:[\\/])/.test(project.rootPath) && !project.rootPath.startsWith("\\\\")) throw new TranslationError("workspace.model.text_d1c2d56874");
  if (!project.rootUri.startsWith("file://")) throw new TranslationError("workspace.model.text_ad622fadef");
  return { id: text(value.id, 128), project, favorite: value.favorite, group: text(value.group, 80, true),
    shell: value.shell, command: validateStartupCommand(value.command), env: validateEnvironment(value.env) };
}

function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TranslationError("workspace.model.text_e5e92a482e");
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function favoriteGroups(catalog: ProjectCatalog) {
  const groups = new Map<string, ProjectProfile[]>();
  for (const entry of catalog.entries.filter((entry) => entry.favorite)) {
    const group = entry.group.trim() || t("workspace.model.text_60a53514eb");
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right, getLocale()));
}

export function unpinnedRecent(catalog: ProjectCatalog, recent: RecentProject[]) {
  return recent.filter((project) => !findProfile(catalog, project.rootPath)?.favorite);
}
