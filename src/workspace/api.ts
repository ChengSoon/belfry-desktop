import { invoke } from "@tauri-apps/api/core";
import type { AgentAvailability, ProjectWorkspace } from "./contracts";

export function openProject(path: string | null) {
  return invoke<ProjectWorkspace>("project_open", { path });
}

export function detectAgents() {
  return invoke<AgentAvailability[]>("agent_detect");
}
