export type AgentKind = "codex" | "claude";

export type AgentLifecycleState =
  | "starting"
  | "processing"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "interrupted"
  | "unknown";

export type AgentStateSource = "hook" | "screen_heuristic" | "process";

export interface AgentCapabilities {
  launch: boolean;
  resume: boolean;
  history: boolean;
  prompt: boolean;
  structuredState: boolean;
}

export interface AgentDescriptor {
  id: string;
  kind: AgentKind;
  displayName: string;
  command: string;
  capabilities: AgentCapabilities;
}

export interface AgentAvailability {
  descriptor: AgentDescriptor;
  kind: AgentKind;
  available: boolean;
  executable: string | null;
  version: string | null;
  reason: string | null;
}

export interface AgentSessionRef {
  agent: AgentKind;
  id: string;
}

export interface AgentStateSnapshot {
  lifecycle: AgentLifecycleState;
  source: AgentStateSource;
  confidence: number | null;
  reason: string | null;
}

export interface AgentLifecycleEvent {
  schemaVersion: number;
  agent: AgentKind;
  session: AgentSessionRef;
  state: AgentLifecycleState;
  source: AgentStateSource;
  occurredAt: number;
  reason: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AgentResumePlan {
  schemaVersion: number;
  session: AgentSessionRef;
  supported: boolean;
  arguments: string[];
}

const MAX_SESSION_ID_LENGTH = 512;

export function isAgentKind(value: string): value is AgentKind {
  return value === "codex" || value === "claude";
}

export function isAgentSessionRef(value: unknown): value is AgentSessionRef {
  if (!isRecord(value) || !isAgentKindValue(value.agent) || typeof value.id !== "string") {
    return false;
  }
  return isAgentSessionId(value.id);
}

export function isAgentSessionId(value: string) {
  return value.length > 0
    && value !== "."
    && new TextEncoder().encode(value).byteLength <= MAX_SESSION_ID_LENGTH
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("..");
}

export function agentProfileId(kind: AgentKind) {
  return `agent:${kind}` as const;
}

export function agentDescriptor(kind: AgentKind): AgentDescriptor {
  return {
    id: agentProfileId(kind),
    kind,
    displayName: kind === "codex" ? "Codex" : "Claude Code",
    command: kind,
    capabilities: {
      launch: true,
      resume: true,
      history: true,
      prompt: true,
      structuredState: false,
    },
  };
}

function isAgentKindValue(value: unknown): value is AgentKind {
  return typeof value === "string" && isAgentKind(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
