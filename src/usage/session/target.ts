import { t } from "../../i18n";
import type { HookSnapshot } from "../../agent/hooks/contracts";
import type { TerminalLaunch } from "../../terminal/contracts";
import type { AgentKind, AgentSessionRef } from "../../agent/contracts";
import { agentKindFromProfile } from "../../agent/contracts";

export function statisticsTarget(launch: Pick<TerminalLaunch, "profileId" | "resumeSessionId">, snapshot: HookSnapshot | null) {
  const agent = agentKindFromProfile(launch.profileId);
  const bound = snapshot?.session?.agent === agent ? snapshot.session : null;
  const session: AgentSessionRef | null = bound ?? (agent && launch.resumeSessionId ? { agent, id: launch.resumeSessionId } : null);
  return {
    session,
    transcriptPath: bound ? snapshot?.transcriptPath ?? null : null,
    note: session ? null : unboundNote(agent, snapshot),
  };
}

// Hook 未连接时 snapshot.reason 已是后端算出的安装状态，比一律劝用户去开 Hook 更对症。
function unboundNote(agent: AgentKind | null, snapshot: HookSnapshot | null) {
  if (!agent) return t("usage.target.text_826bc40e35");
  const reason = snapshot && snapshot.source !== "hook" ? snapshot.reason : null;
  return reason ? t("usage.target.unboundReason", { reason }) : t("usage.target.unboundSetup");
}
