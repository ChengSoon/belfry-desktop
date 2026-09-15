import { invoke } from "@tauri-apps/api/core";
import type { ProjectProviderReport, ProjectProviderSelection } from "./contracts";

export const readProjectProviders = (rootPath: string) => invoke<ProjectProviderReport>("project_provider_report", { rootPath });
export const selectProjectProvider = (selection: ProjectProviderSelection) => invoke<ProjectProviderReport>("project_provider_select", { selection });
