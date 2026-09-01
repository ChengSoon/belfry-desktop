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

export type SkillInstallAction = "installed" | "updated" | "unchanged";

export interface SkillInstallOutcome {
  action: SkillInstallAction;
  path: string;
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
