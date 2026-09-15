import type { ShellProfileId } from "../../terminal/contracts";
import type { ProjectWorkspace } from "../contracts";

export const PROJECT_CATALOG_KEY = "belfry.project-catalog.v1";
export const PROJECT_CATALOG_EVENT = "belfry:project-catalog-changed";
export const MAX_PROJECTS = 200;
export const MAX_COMMAND_LENGTH = 4_000;
export const MAX_ENVIRONMENT_ENTRIES = 32;
export const MAX_ENVIRONMENT_VALUE = 2_048;
export const MAX_CATALOG_BYTES = 1_000_000;

export interface ProjectProfile {
  id: string;
  project: ProjectWorkspace;
  favorite: boolean;
  group: string;
  shell: ShellProfileId;
  command: string;
  env: Record<string, string>;
}

export interface ProjectCatalog { version: 1; entries: ProjectProfile[] }
export interface CatalogLoad { catalog: ProjectCatalog; raw: string | null; error: string | null }

/** 只在当前 UI 生命周期中存在，不进入工作区或备份存档。 */
export interface StartupIntent { readonly command: string }
export interface ProjectLaunch { env: Record<string, string>; startup?: StartupIntent }
