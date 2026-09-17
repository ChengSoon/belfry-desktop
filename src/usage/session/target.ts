import type { HookSnapshot } from "../../agent/hooks/contracts";
import type { TerminalLaunch } from "../../terminal/contracts";
import type { AgentKind, AgentSessionRef } from "../../agent/contracts";

export function statisticsTarget(launch: TerminalLaunch, snapshot: HookSnapshot | null) {
  const agent =
    launch.profileId === "agent:codex" ? "codex"
    : launch.profileId === "agent:claude" ? "claude"
    : launch.profileId === "agent:pi" ? "pi" : null;
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
  if (!agent) return "当前会话不是受支持的原生 Agent 会话，没有原生会话可统计。";
  const reason = snapshot && snapshot.source !== "hook" ? snapshot.reason : null;
  return `尚未绑定原生会话。${reason ?? "可在设置 → 会话状态中启用 Hook"}。也可从历史记录继续会话。`;
}
