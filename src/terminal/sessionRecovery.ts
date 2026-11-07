import { isAgentKind, isAgentSessionId, type AgentSessionRef } from "../agent/contracts";
import type { TerminalLaunch } from "./contracts";

export const RECONNECT_DELAYS_MS = [500, 1000, 2000] as const;
export const RECONNECT_STABLE_MS = 10_000;

/** 接驳身份和原生历史身份都不能跨标签、Agent 类型或目录借用。 */
export function sameTerminalTarget(left: TerminalLaunch, right: TerminalLaunch) {
  return left.tabId === right.tabId && left.profileId === right.profileId
    && left.cwd === right.cwd && left.ssh === right.ssh;
}

export function matchingSessionId(launch: TerminalLaunch, session: AgentSessionRef | null | undefined) {
  return session && launch.profileId === `agent:${session.agent}` && isAgentSessionId(session.id)
    ? session.id : null;
}

export function initialResumeSessionId(launch: TerminalLaunch) {
  if (!launch.profileId.startsWith("agent:")) return null;
  return matchingSessionId(launch, launch.agentSessionRef) ?? launch.resumeSessionId;
}

export function sessionRefForLaunch(launch: TerminalLaunch, id: string | null): AgentSessionRef | null {
  const agent = launch.profileId.slice("agent:".length);
  return launch.profileId.startsWith("agent:") && isAgentKind(agent) && id && isAgentSessionId(id) ? { agent, id } : null;
}
