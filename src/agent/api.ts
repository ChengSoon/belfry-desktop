import { invoke } from "@tauri-apps/api/core";
import type {
  AgentDescriptor,
  AgentKind,
  AgentResumePlan,
} from "./contracts";

export function listAgentDescriptors() {
  return invoke<AgentDescriptor[]>("agent_descriptors");
}

export function planAgentResume(agent: AgentKind, sessionId: string) {
  return invoke<AgentResumePlan>("agent_resume_plan", {
    agent,
    sessionId,
  });
}
