import { invoke } from "@tauri-apps/api/core";
import type { ProjectDirectory, ProjectFilePreview } from "./contracts";

export function listProjectDirectory(rootPath: string, relativePath: string) {
  return invoke<ProjectDirectory>("project_list_directory", {
    rootPath,
    relativePath: relativePath || null,
  });
}

export function readProjectFile(rootPath: string, relativePath: string) {
  return invoke<ProjectFilePreview>("project_read_file", { rootPath, relativePath });
}
