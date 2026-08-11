import { describe, expect, it } from "vitest";
import type { SessionActivity, TerminalPhase } from "../terminal/contracts";
import { closeConfirmBody, needsCloseConfirm } from "./closeConfirm";
import { createWorkspaceTab } from "./tabs";

const project = { id: "p1", name: "demo", rootPath: "/demo", rootUri: "file:///demo" };
const tab = (phase: TerminalPhase, activity: SessionActivity = "idle") => ({
  ...createWorkspaceTab(project, "claude", 1),
  phase,
  activity,
});

describe("close confirmation", () => {
  it("asks before killing a session whose process is still alive", () => {
    expect(needsCloseConfirm(tab("idle"))).toBe(true);
    expect(needsCloseConfirm(tab("creating"))).toBe(true);
    expect(needsCloseConfirm(tab("running"))).toBe(true);
  });

  it("closes a dead session outright", () => {
    // 进程已经没了，这一下不杀任何东西——拦一道只是让人多点一次。
    expect(needsCloseConfirm(tab("exited"))).toBe(false);
    expect(needsCloseConfirm(tab("error"))).toBe(false);
  });

  it("names what the session is busy with", () => {
    expect(closeConfirmBody(tab("running", "talking"))).toContain("正在生成回复");
    expect(closeConfirmBody(tab("running", "awaiting-choice"))).toContain("正在等待你选择");
    expect(closeConfirmBody(tab("creating"))).toContain("还在启动");
  });

  it("states the cost of closing in every case", () => {
    for (const sample of [tab("idle"), tab("running"), tab("running", "talking"), tab("creating")]) {
      expect(closeConfirmBody(sample)).toContain("滚屏内容不再保留");
    }
  });

  it("says nothing extra when a running session is just sitting there", () => {
    // 闲着的会话没有"在忙什么"可报，正文就该只剩后果那一句。
    expect(closeConfirmBody(tab("running"))).toBe("关闭后进程会被结束，滚屏内容不再保留。");
  });
});
