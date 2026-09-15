import type { HookSnapshot } from "../../agent/hooks/contracts";
import type { TerminalLaunch } from "../../terminal/contracts";
import type { AgentSessionRef } from "../../agent/contracts";

export function statisticsTarget(launch: TerminalLaunch, snapshot: HookSnapshot | null) {
  const agent = launch.profileId === "agent:codex" ? "codex" : launch.profileId === "agent:claude" ? "claude" : null;
  const bound = snapshot?.session?.agent === agent ? snapshot.session : null;
  const session: AgentSessionRef | null = bound ?? (agent && launch.resumeSessionId ? { agent, id: launch.resumeSessionId } : null);
  return { session, transcriptPath: bound ? snapshot?.transcriptPath ?? null : null };
}
