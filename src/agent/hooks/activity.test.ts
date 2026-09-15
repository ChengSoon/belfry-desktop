import { afterEach, expect, it, vi } from "vitest";
import { HookActivity, type ActivityView } from "./activity";
import type { HookSnapshot } from "./contracts";

const snapshot = (state: HookSnapshot["state"], sequence: number): HookSnapshot => ({
  sequence, agent: "codex", session: { agent: "codex", id: "native" }, state,
  source: "hook", occurredAt: sequence, reason: "状态", transcriptPath: null,
});

function setup() {
  vi.useFakeTimers();
  const changes: ActivityView[] = [];
  const activity = new HookActivity((view) => changes.push(view));
  const latest = () => changes.at(-1);
  return { activity, changes, latest };
}

afterEach(() => vi.useRealTimers());

it("未连接 Hook 时继续使用屏幕推断", () => {
  const { activity, latest } = setup();
  activity.screen("talking");
  expect(latest()?.activity).toBe("talking");
  expect(latest()?.hook).toBeNull();
  activity.dispose();
});

it("屏幕空闲和旧事件不能覆盖 Hook 的批准等待", () => {
  const { activity, latest } = setup();
  activity.accept(snapshot("awaiting_input", 2));
  activity.screen("idle");
  activity.accept(snapshot("completed", 1));
  vi.advanceTimersByTime(4000);
  expect(latest()?.activity).toBe("awaiting-choice");
  expect(latest()?.hook?.state).toBe("awaiting_input");
  activity.dispose();
});

it("Stop 在屏幕仍忙或停在批准框时不开放队列", () => {
  const { activity, latest } = setup();
  activity.accept(snapshot("processing", 1));
  activity.screen("talking");
  activity.accept(snapshot("completed", 2));
  vi.advanceTimersByTime(2000);
  expect(latest()?.activity).toBe("talking");
  activity.screen("awaiting-choice");
  expect(latest()?.activity).not.toBe("idle");
  activity.screen("idle");
  expect(latest()?.activity).toBe("idle");
  expect(latest()?.hook?.state).toBe("completed");
  activity.dispose();
});

it("完成候选要稳定后生效，重复事件不重复发布", () => {
  const { activity, latest, changes } = setup();
  activity.accept(snapshot("processing", 1));
  activity.accept(snapshot("completed", 2));
  vi.advanceTimersByTime(1000);
  expect(latest()?.activity).toBe("talking");
  vi.advanceTimersByTime(1000);
  expect(latest()?.hook?.state).toBe("completed");
  const count = changes.length;
  activity.accept(snapshot("completed", 2));
  vi.advanceTimersByTime(2000);
  expect(changes).toHaveLength(count);
  activity.dispose();
});

it("其他 Stop Hook 继续处理时撤销完成候选", () => {
  const { activity, latest } = setup();
  activity.accept(snapshot("processing", 1));
  activity.accept(snapshot("completed", 2));
  vi.advanceTimersByTime(500);
  activity.accept(snapshot("processing", 3));
  vi.advanceTimersByTime(2000);
  expect(latest()?.activity).toBe("talking");
  expect(latest()?.hook?.state).toBe("processing");
  activity.dispose();
});

it("进程退出会取消尚未确认的完成事件", () => {
  const { activity, changes, latest } = setup();
  activity.accept(snapshot("processing", 1));
  activity.accept(snapshot("completed", 2));
  activity.accept({ ...snapshot("failed", 3), source: "process" });
  activity.stop();
  vi.advanceTimersByTime(3000);
  expect(latest()?.hook?.state).toBe("failed");
  expect(changes.some((view) => view.hook?.state === "completed")).toBe(false);
  activity.dispose();
});
