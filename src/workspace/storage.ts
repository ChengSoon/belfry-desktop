import type { ProjectWorkspace, RecentProject } from "./contracts";

export const RECENT_PROJECTS_KEY = "otty.recent-projects.v1";
export const RECENT_PROJECTS_LIMIT = 6;

export function loadRecentProjects(storage: Pick<Storage, "getItem"> = localStorage) {
  try {
    return parseRecentProjects(storage.getItem(RECENT_PROJECTS_KEY));
  } catch {
    return [];
  }
}

export function saveRecentProjects(
  projects: RecentProject[],
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  storage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(projects.slice(0, RECENT_PROJECTS_LIMIT)));
}

export function rememberProject(project: ProjectWorkspace, recent: RecentProject[]) {
  const entry = { id: project.id, name: project.name, rootPath: project.rootPath };
  return deduplicateByRootPath([entry, ...recent]);
}

export function parseRecentProjects(value: string | null): RecentProject[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return deduplicateByRootPath(parsed.filter(isRecentProject));
}

function deduplicateByRootPath(projects: RecentProject[]) {
  const roots = new Set<string>();
  return projects
    .filter((project) => {
      if (roots.has(project.rootPath)) return false;
      roots.add(project.rootPath);
      return true;
    })
    .slice(0, RECENT_PROJECTS_LIMIT);
}

function isRecentProject(value: unknown): value is RecentProject {
  if (typeof value !== "object" || !value) return false;
  const item = value as Record<string, unknown>;
  return [item.id, item.name, item.rootPath].every((field) => typeof field === "string");
}
