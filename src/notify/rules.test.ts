import { describe, expect, it } from "vitest";
import { classifyTransition, notifyContent, shouldSuppress } from "./rules";

describe("classifyTransition", () => {
  it("announces a pending choice from either direction", () => {
    // 权限框可以直接从生成中弹出来，也可以在闲置时弹（Agent 刚接到指令就先问权限）。
    expect(classifyTransition("talking", "awaiting-choice", "claude")).toBe("awaiting-choice");
    expect(classifyTransition("idle", "awaiting-choice", "codex")).toBe("awaiting-choice");
  });

  it("treats talking → idle as finished", () => {
    expect(classifyTransition("talking", "idle", "claude")).toBe("finished");
  });

  it("stays silent when the user just answered the prompt", () => {
    // 这两条跃迁的前提都是用户刚按了键，人就在屏幕前，再弹通知纯属骚扰。
    expect(classifyTransition("awaiting-choice", "idle", "claude")).toBeNull();
    expect(classifyTransition("awaiting-choice", "talking", "claude")).toBeNull();
  });

  it("stays silent when work merely starts", () => {
    expect(classifyTransition("idle", "talking", "codex")).toBeNull();
  });

  it("never notifies for shell sessions", () => {
    // Shell 的 activity 恒为 idle，真跃迁了也没有 Agent 在等谁。
    expect(classifyTransition("talking", "idle", "shell")).toBeNull();
    expect(classifyTransition("idle", "awaiting-choice", "shell")).toBeNull();
  });

  it("ignores no-op transitions", () => {
    expect(classifyTransition("talking", "talking", "claude")).toBeNull();
    expect(classifyTransition("awaiting-choice", "awaiting-choice", "claude")).toBeNull();
  });
});

describe("shouldSuppress", () => {
  it("only stays quiet when the session is on screen in a focused window", () => {
    expect(shouldSuppress(true, true)).toBe(true);
    // 窗口在前台但这条会话被别的窗格顶掉了，用户看不见它的状态。
    expect(shouldSuppress(true, false)).toBe(false);
    // 会话在舞台上但窗口在后台，等于没人看。
    expect(shouldSuppress(false, true)).toBe(false);
    expect(shouldSuppress(false, false)).toBe(false);
  });
});

describe("notifyContent", () => {
  it("leads with the state, not the session name", () => {
    expect(notifyContent("awaiting-choice", "belfry", "重构 usage 聚合")).toEqual({
      title: "在等你确认",
      body: "belfry · 重构 usage 聚合",
    });
    expect(notifyContent("finished", "belfry", "跑一遍测试")).toEqual({
      title: "已跑完",
      body: "belfry · 跑一遍测试",
    });
  });
});
