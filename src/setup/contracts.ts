export type CheckState = "ok" | "warning" | "error";

export interface EnvironmentCheck {
  id: string;
  label: string;
  state: CheckState;
  summary: string;
}

export interface EnvironmentReport {
  overall: CheckState;
  checkedAt: number;
  checks: EnvironmentCheck[];
}

export type AgentKind = "codex" | "claude";
export type SkillInstallAction = "installed" | "updated" | "unchanged" | "failed";

export interface SkillInstallTargetOutcome {
  agent: AgentKind;
  action: SkillInstallAction;
  path: string | null;
  summary: string;
}

export interface SkillInstallOutcome {
  results: SkillInstallTargetOutcome[];
}

export interface SkillInstallFeedback {
  notice: string | null;
  failure: string | null;
}

export interface CheckCounts {
  ok: number;
  warning: number;
  error: number;
}

export function countChecks(report: EnvironmentReport): CheckCounts {
  return report.checks.reduce<CheckCounts>((counts, check) => {
    counts[check.state] += 1;
    return counts;
  }, { ok: 0, warning: 0, error: 0 });
}

const AGENT_LABEL: Record<AgentKind, string> = {
  codex: "Codex",
  claude: "Claude Code",
};

export function summarizeSkillInstall(outcome: SkillInstallOutcome): SkillInstallFeedback {
  const failed = outcome.results.filter((result) => result.action === "failed");
  const succeeded = outcome.results.filter((result) => result.action !== "failed");
  const changed = succeeded.filter((result) => result.action !== "unchanged").length;
  const unchanged = succeeded.length - changed;
  const notice = succeeded.length === 0
    ? null
    : `已同步 ${succeeded.length} 个客户端（安装/更新 ${changed}，已是最新 ${unchanged}）`;
  const failure = failed.length === 0
    ? null
    : failed.map((result) => `${AGENT_LABEL[result.agent]}：${result.summary}`).join("；");
  return { failure, notice };
}
