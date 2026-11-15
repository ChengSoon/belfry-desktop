export type AuthKind = "none" | "bearer" | "apiKey";
export type CredentialEdit =
  | { action: "keep" }
  | { action: "replace"; value: string }
  | { action: "clear" };

export interface ConnectionDraft {
  id?: string;
  name: string;
  cardUrl: string;
  interfaceUrl?: string | null;
  interfaceTenant?: string | null;
  auth: { kind: AuthKind; headerName?: string | null; credential: CredentialEdit };
}

export interface ConnectionInfo {
  id: string;
  name: string;
  rootPath: string;
  cardUrl: string;
  interfaceUrl: string | null;
  interfaceTenant?: string | null;
  auth: { kind: AuthKind; headerName: string | null; hasCredential: boolean };
  revision: string;
  local?: { tabId: string; agent: string; ready: boolean };
}

export interface LocalDiscovery {
  agents: ConnectionInfo[];
  unsupported: { tabId: string; name: string; agent: string; reason: string }[];
}

export interface LocalTask {
  reportHandle: string;
  generation: number;
  taskRef: TaskRef;
  task: Record<string, unknown>;
  instruction: string;
  source: { kind: "direct" | "room"; roomId?: string; roomName?: string; taskId: string };
}

export interface TaskRef {
  kind: "direct_task" | "room_task";
  roomId: string | null;
  id: string;
  generation: number;
}

/** A bounded public projection; authoritative business states remain separate. */
export interface ProtocolTaskPreview {
  taskRef: TaskRef;
  protocolTaskId: string;
  state: string;
  text: string | null;
  textTruncated: boolean;
  artifacts: { artifactId: string; name?: string | null; text: string; truncated: boolean }[];
  source: "localA2A";
}

export interface ProtocolTaskSnapshot { tasks: ProtocolTaskPreview[] }

export interface AgentInterface {
  url: string;
  protocolBinding: "JSONRPC";
  protocolVersion: "1.0";
  tenant?: string;
}

export interface Discovery {
  card: Record<string, unknown>;
  interfaces: AgentInterface[];
  selectedInterface: AgentInterface | null;
  issue: { code: string; message: string } | null;
}

export interface TaskReply {
  kind: "task";
  connectionId: string;
  taskHandle: string;
  task: Record<string, unknown>;
  terminal: boolean;
}

export interface MessageReply {
  kind: "message";
  connectionId: string;
  message: Record<string, unknown>;
}
