import { invoke } from "@tauri-apps/api/core";
import type { AgentKind } from "../agent/contracts";
import type { AgentRelease, AgentReleaseInstall } from "./contracts";

export function fetchAgentReleases() {
  return invoke<AgentRelease[]>("agent_release_report");
}

export function installAgentRelease(kind: AgentKind) {
  return invoke<AgentReleaseInstall>("agent_release_install", { kind });
}
