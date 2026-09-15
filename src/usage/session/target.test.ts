import { expect, it } from "vitest";
import { statisticsTarget } from "./target";
import type { TerminalLaunch } from "../../terminal/contracts";
import type { HookSnapshot } from "../../agent/hooks/contracts";

const launch: TerminalLaunch = { profileId: "agent:codex", cwd: null, resumeSessionId: "resumed",
  tabId: "tab", collaborationMode: false, ssh: null };
const snapshot: HookSnapshot = { sequence: 1, agent: "codex", session: { agent: "codex", id: "native" },
  state: "processing", source: "hook", occurredAt: 1, reason: "正在处理", transcriptPath: "/logs/native.jsonl" };

it("优先使用 Hook 当前身份和对应日志，身份尚未绑定时可读取显式恢复的会话", () => {
  expect(statisticsTarget(launch, snapshot)).toEqual({ session: snapshot.session, transcriptPath: snapshot.transcriptPath });
  expect(statisticsTarget(launch, null)).toEqual({ session: { agent: "codex", id: "resumed" }, transcriptPath: null });
});

it("另一个 Agent 的身份和日志不能进入当前会话统计", () => {
  const foreign = { ...snapshot, session: { agent: "claude" as const, id: "foreign" } };
  expect(statisticsTarget({ ...launch, resumeSessionId: null }, foreign)).toEqual({ session: null, transcriptPath: null });
});
