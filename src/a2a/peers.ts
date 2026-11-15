import { t } from "../i18n";
import type { ConnectionInfo, LocalDiscovery } from "./contracts";

/** One addressable peer in the link field. Local agents have no user actions. */
export interface Peer {
  key: string;
  name: string;
  kind: "local" | "external";
  state: "ready" | "warn";
  agent?: string;
  url?: string;
  /** Backend reason code for an unsupported local adapter; translated at render time. */
  reason?: string;
  connection?: ConnectionInfo;
}

/** How many nodes one side can show before collapsing the rest behind a +N node. */
export const PEER_LIMIT = 4;

export function localAgentReason(reason: string): string {
  const known: Record<string, string> = {
    adapterNotReady: "a2a.local.reasons.notReady",
    adapterUnsupported: "a2a.local.reasons.unsupported",
    instanceUnavailable: "a2a.local.reasons.offline",
  };
  return t(known[reason] ?? "a2a.local.reasons.notReady");
}

export function peersOf(discovery: LocalDiscovery | null, connections: ConnectionInfo[]): Peer[] {
  const local: Peer[] = discovery ? [
    ...discovery.agents.map(agent => ({
      key: agent.id, name: agent.name, kind: "local" as const,
      state: agent.local?.ready ? "ready" as const : "warn" as const,
      agent: agent.local?.agent, connection: agent,
    })),
    ...discovery.unsupported.map(agent => ({
      key: agent.tabId, name: agent.name, kind: "local" as const, state: "warn" as const,
      agent: agent.agent, reason: agent.reason,
    })),
  ] : [];
  const external: Peer[] = connections.map(connection => ({
    key: connection.id, name: connection.name, kind: "external" as const,
    state: connection.auth.kind === "none" || connection.auth.hasCredential ? "ready" as const : "warn" as const,
    url: connection.cardUrl, connection,
  }));
  return [...local, ...external];
}

/** Split one side into the nodes the map shows and the ones behind a +N node. */
export function visiblePeers(peers: Peer[], kind: Peer["kind"]): { shown: Peer[]; hidden: Peer[] } {
  const side = peers.filter(peer => peer.kind === kind);
  if (side.length <= PEER_LIMIT) return { shown: side, hidden: [] };
  return { shown: side.slice(0, PEER_LIMIT - 1), hidden: side.slice(PEER_LIMIT - 1) };
}

export function peerStatusText(peer: Peer): string {
  if (peer.kind === "local") return t(peer.state === "ready" ? "a2a.local.ready" : "a2a.local.notReady");
  if (peer.connection?.auth.kind === "none") return t("a2a.auth.none");
  return t(peer.connection?.auth.hasCredential ? "a2a.auth.configured" : "a2a.auth.missing");
}
