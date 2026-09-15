import { afterEach, expect, it, vi } from "vitest";
import type { HookSnapshot } from "../agent/hooks/contracts";
import { ActivityNotifier, type NotifiableSession } from "./scheduler";
import type { NotifyContent } from "./rules";

const session = (state: HookSnapshot["state"], sequence: number): NotifiableSession => ({
  id: "tab", kind: "codex", activity: state === "processing" ? "talking" : state === "awaiting_input" ? "awaiting-choice" : "idle",
  phase: "running", title: "任务", project: { name: "项目" },
  agentState: { state, sequence, agent: "codex", session: { agent: "codex", id: "native" }, source: "hook",
    occurredAt: sequence, reason: "状态", transcriptPath: null },
});

function setup() {
  vi.useFakeTimers();
  const notices: NotifyContent[] = [];
  const notifier = new ActivityNotifier({ notify: (content) => notices.push(content), setBadge: () => {} });
  const sync = (value: NotifiableSession) => notifier.sync([value], new Set(), false);
  return { notifier, notices, sync };
}

afterEach(() => vi.useRealTimers());

it("确认过的 Hook 完成不依赖恰好观察到屏幕 talking", () => {
  const { notifier, notices, sync } = setup();
  sync(session("unknown", 0));
  sync(session("completed", 1));
  sync(session("completed", 1));
  vi.advanceTimersByTime(2000);
  expect(notices.map((notice) => notice.title)).toEqual(["已跑完"]);
  notifier.dispose();
});

it("Hook 失败只发送失败通知，进程失败不会重复通知", () => {
  const { notifier, notices, sync } = setup();
  sync(session("processing", 1));
  sync(session("failed", 2));
  const exited = session("failed", 3);
  exited.agentState!.source = "process";
  exited.phase = "exited";
  sync(exited);
  vi.advanceTimersByTime(3000);
  expect(notices.map((notice) => notice.title)).toEqual(["本轮未完成"]);
  notifier.dispose();
});

it("中断和退出都不冒充本轮完成", () => {
  const { notifier, notices, sync } = setup();
  sync(session("processing", 1));
  sync(session("interrupted", 2));
  vi.advanceTimersByTime(2000);
  expect(notices).toEqual([]);
  const fallback = { ...session("processing", 3), agentState: null };
  sync(fallback);
  sync({ ...fallback, activity: "idle", phase: "exited" });
  vi.advanceTimersByTime(2000);
  expect(notices).toEqual([]);
  notifier.dispose();
});

it("重复权限事件只通知一次且不会产生完成通知", () => {
  const { notifier, notices, sync } = setup();
  sync(session("processing", 1));
  sync(session("awaiting_input", 2));
  sync(session("awaiting_input", 3));
  vi.advanceTimersByTime(2000);
  expect(notices.map((notice) => notice.title)).toEqual(["在等你确认"]);
  notifier.dispose();
});
