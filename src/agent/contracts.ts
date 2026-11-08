export const AGENT_KINDS = ["codex", "claude", "pi", "antigravity", "opencode", "kimi"] as const;
export type AgentKind = typeof AGENT_KINDS[number];

export const AGENT_METADATA: Record<AgentKind, { name: string; command: string; reset: string | null }> = {
  codex: { name: "Codex", command: "codex", reset: "/new" },
  claude: { name: "Claude Code", command: "claude", reset: "/clear" },
  pi: { name: "Pi", command: "pi", reset: null },
  antigravity: { name: "Antigravity CLI", command: "agy", reset: "/new" },
  opencode: { name: "OpenCode", command: "opencode", reset: "/new" },
  kimi: { name: "Kimi Code", command: "kimi", reset: "/new" },
};

export function agentRecord<T>(create: (kind: AgentKind) => T): Record<AgentKind, T> {
  return Object.fromEntries(AGENT_KINDS.map((kind) => [kind, create(kind)])) as Record<AgentKind, T>;
}

export function agentKindFromProfile(profileId: string): AgentKind | null {
  const kind = profileId.startsWith("agent:") ? profileId.slice(6) : null;
  return isAgentKind(kind) ? kind : null;
}

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

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
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
    displayName: AGENT_METADATA[kind].name,
    command: AGENT_METADATA[kind].command,
    capabilities: {
      launch: true,
      resume: true,
      history: true,
      prompt: true,
      structuredState: false,
    },
  };
}

/**
 * 各 Agent 自己的「重置对话」命令：清空上下文、开始新会话。
 * Claude 是 `/clear`、Codex 是 `/new`（与快捷指令目录的列法一致）；Pi 没有已知的等价命令。
 */
export function agentResetCommand(kind: AgentKind): string | null {
  return AGENT_METADATA[kind].reset;
}

function isAgentKindValue(value: unknown): value is AgentKind {
  return typeof value === "string" && isAgentKind(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
