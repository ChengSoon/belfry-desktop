import { expect, it } from "vitest";
import { statisticsTarget } from "./target";
import type { TerminalLaunch } from "../../terminal/contracts";
import type { HookSnapshot } from "../../agent/hooks/contracts";

const launch: TerminalLaunch = { profileId: "agent:codex", cwd: null, resumeSessionId: "resumed",
  tabId: "tab", collaborationMode: false, ssh: null };
const snapshot: HookSnapshot = { sequence: 1, agent: "codex", session: { agent: "codex", id: "native" },
  state: "processing", source: "hook", occurredAt: 1, reason: "正在处理", transcriptPath: "/logs/native.jsonl" };
const unbound: TerminalLaunch = { ...launch, resumeSessionId: null };

it("优先使用 Hook 当前身份和对应日志，身份尚未绑定时可读取显式恢复的会话", () => {
  expect(statisticsTarget(launch, snapshot)).toEqual({ session: snapshot.session, transcriptPath: snapshot.transcriptPath, note: null });
  expect(statisticsTarget(launch, null)).toEqual({ session: { agent: "codex", id: "resumed" }, transcriptPath: null, note: null });
});

it("另一个 Agent 的身份和日志不能进入当前会话统计", () => {
  const foreign = { ...snapshot, session: { agent: "claude" as const, id: "foreign" } };
  const target = statisticsTarget(unbound, foreign);
  expect(target.session).toBeNull();
  expect(target.transcriptPath).toBeNull();
});

it("未绑定时转述 Hook 给出的安装状态，而不是一律让用户去启用 Hook", () => {
  const pending: HookSnapshot = { ...snapshot, session: null, source: "screen_heuristic",
    reason: "Codex 未开启 hooks 特性：在 config.toml 的 [features] 下设 hooks = true 后重开会话" };
  const note = statisticsTarget(unbound, pending).note;
  expect(note).toContain("尚未绑定原生会话");
  expect(note).toContain("hooks = true");
  expect(note).toContain("历史记录");
  expect(statisticsTarget(unbound, null).note).toContain("设置 → 会话状态");
  expect(statisticsTarget({ ...unbound, profileId: "shell:zsh" }, null).note).toContain("不是 Claude 或 Codex 会话");
});
