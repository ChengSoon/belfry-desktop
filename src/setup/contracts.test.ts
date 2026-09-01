import { describe, expect, it } from "vitest";
import {
  countChecks,
  summarizeSkillInstall,
  type EnvironmentReport,
} from "./contracts";

describe("countChecks", () => {
  it("counts each diagnostic state", () => {
    const report: EnvironmentReport = {
      overall: "error",
      checkedAt: 1,
      checks: [
        { id: "one", label: "one", state: "ok", summary: "ok" },
        { id: "two", label: "two", state: "warning", summary: "warning" },
        { id: "three", label: "three", state: "error", summary: "error" },
      ],
    };

    expect(countChecks(report)).toEqual({ ok: 1, warning: 1, error: 1 });
  });
});

describe("summarizeSkillInstall", () => {
  it("reports partial success without hiding the failed agent", () => {
    const feedback = summarizeSkillInstall({
      results: [
        { agent: "codex", action: "unchanged", path: "/codex", summary: "已是最新" },
        { agent: "claude", action: "failed", path: null, summary: "目录不可写" },
      ],
    });

    expect(feedback).toEqual({
      notice: "已同步 1 个客户端（安装/更新 0，已是最新 1）",
      failure: "Claude Code：目录不可写",
    });
  });
});
