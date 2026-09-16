import type { AgentKind, AgentLifecycleState, AgentSessionRef, AgentStateSource } from "../contracts";

export interface HookSnapshot {
  sequence: number;
  agent: AgentKind;
  session: AgentSessionRef | null;
  state: AgentLifecycleState;
  source: AgentStateSource;
  occurredAt: number;
  reason: string;
  transcriptPath: string | null;
}

export interface AgentHookReport {
  kind: AgentKind;
  version: string | null;
  supported: boolean;
  configPath: string | null;
  installed: number;
  expected: number;
  stale: number;
  disabled: boolean;
  note: string;
  error: string | null;
}

export interface HookInstallPreview {
  id: string;
  kind: AgentKind;
  configPath: string;
  enabling: boolean;
  command: string | null;
  events: string[];
  managedBefore: number;
}
