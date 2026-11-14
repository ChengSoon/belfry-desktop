import { describe, expect, it } from "vitest";
import { ActivityNotifier, type NotifiableSession } from "./scheduler";
import type { NotifyContent } from "./rules";
import { statusReport } from "../terminal/fixtures/programStatus";

describe.each(["codex", "claude"] as const)("%s protocol notifications", agent => {
  function setup() {
    const notices: NotifyContent[] = [];
    const badges: number[] = [];
    const notifier = new ActivityNotifier({ notify: content => notices.push(content), setBadge: count => badges.push(count) });
    const tab: NotifiableSession = { id: "tab", kind: agent, activity: "idle", phase: "running", title: "task", project: { name: "project" } };
    const sync = (state: Parameters<typeof statusReport>[1], sequence: number, kind?: Parameters<typeof statusReport>[3]) =>
      notifier.sync([{ ...tab, agentState: statusReport(agent, state, sequence, kind) }], new Set(), false);
    notifier.sync([tab], new Set(), false);
    return { notices, badges, notifier, sync, tab };
  }

  it("treats cancellation as idle and only announces explicit done or error reports", () => {
    const f = setup();
    f.sync("idle", 1);
    f.sync("working", 2);
    f.sync("idle", 3);
    expect(f.notices).toEqual([]);
    f.sync("working", 4);
    f.sync("done", 5);
    f.sync("done", 6);
    expect(f.notices.map(notice => notice.title)).toEqual(["已跑完"]);
    f.sync("clear", 7);
    f.sync("error", 8);
    f.notifier.sync([{ ...f.tab, phase: "exited", agentState: statusReport(agent, "error", 8) }], new Set(), false);
    expect(f.notices.map(notice => notice.title)).toEqual(["已跑完", "本轮未完成"]);
    f.notifier.dispose();
  });

  it("uses blocking kinds for notifications and badges, without reading the legacy activity", () => {
    const f = setup();
    f.sync("working", 1);
    f.sync("blocked", 2, "permission");
    f.sync("blocked", 3, "permission");
    f.sync("blocked", 4, "question");
    f.sync("blocked", 5, "auth");
    expect(f.notices.map(notice => notice.title)).toEqual(["在等你确认", "在等你回答", "需要你登录"]);
    expect(f.badges.at(-1)).toBe(1);
    f.sync("working", 6);
    expect(f.badges.at(-1)).toBe(0);
    f.notifier.dispose();
  });

  it("ignores old Hooks, other agents and status-less snapshots", () => {
    const f = setup();
    const done = statusReport(agent, "done", 1);
    for (const agentState of [{ ...done, source: "hook" as const }, { ...done, source: "process" as const },
      { ...done, programStatus: null }, statusReport(agent === "codex" ? "claude" : "codex", "done", 999)]) {
      f.notifier.sync([{ ...f.tab, activity: "idle", agentState }], new Set(), false);
    }
    expect(f.notices).toEqual([]);
    f.notifier.dispose();
  });

  it("preserves final results across process exit without treating exit itself as completion", () => {
    const f = setup();
    f.sync("working", 1);
    f.notifier.sync([{ ...f.tab, activity: "idle", phase: "exited", agentState: statusReport(agent, "done", 2) }], new Set(), false);
    expect(f.notices.map(notice => notice.title)).toEqual(["已跑完"]);
    f.notifier.sync([{ ...f.tab, activity: "idle", phase: "exited", agentState: statusReport(agent, "done", 2) }], new Set(), false);
    expect(f.notices).toHaveLength(1);
    f.notifier.dispose();
  });
});
