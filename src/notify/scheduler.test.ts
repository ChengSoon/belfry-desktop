import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityNotifier, type NotifiableSession } from "./scheduler";
import { FINISHED_CONFIRM_MS, type NotifyContent } from "./rules";

function session(overrides: Partial<NotifiableSession> & { id: string }): NotifiableSession {
  return {
    kind: "claude",
    activity: "idle",
    title: "跑一遍测试",
    project: { name: "belfry" },
    ...overrides,
  };
}

/** 基线：窗口在后台、没有会话画在舞台上——也就是"该通知"的处境。 */
function harness() {
  const notified: NotifyContent[] = [];
  const badges: number[] = [];
  const notifier = new ActivityNotifier({
    notify: (content) => notified.push(content),
    setBadge: (count) => badges.push(count),
  });
  const away = new Set<string>();
  return {
    notified,
    badges,
    dispose: () => notifier.dispose(),
    sync: (sessions: NotifiableSession[], visible = away, focused = false) =>
      notifier.sync(sessions, visible, focused),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("完成通知的确认窗口", () => {
  it("holds the finished notice until the session stays idle", () => {
    const app = harness();
    app.sync([session({ id: "a", activity: "talking" })]);
    app.sync([session({ id: "a", activity: "idle" })]);
    // 还没到确认时限，一条都不该发出去。
    expect(app.notified).toEqual([]);

    vi.advanceTimersByTime(FINISHED_CONFIRM_MS);
    expect(app.notified).toEqual([{ title: "已跑完", body: "belfry · 跑一遍测试" }]);
  });

  it("drops the finished notice when a choice prompt shows up right after", () => {
    // 这是最常见的误报来源：spinner 先消失（读成一帧 idle），权限框隔一拍才画出来。
    // 用户该收到的只有"在等你确认"，绝不能先收一条"已跑完"。
    const app = harness();
    app.sync([session({ id: "a", activity: "talking" })]);
    app.sync([session({ id: "a", activity: "idle" })]);
    app.sync([session({ id: "a", activity: "awaiting-choice" })]);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS * 2);

    expect(app.notified).toEqual([{ title: "在等你确认", body: "belfry · 跑一遍测试" }]);
  });

  it("drops the finished notice when the agent picks work back up", () => {
    // 两次工具调用之间被读成一帧 idle，接着又回到生成中。
    const app = harness();
    app.sync([session({ id: "a", activity: "talking" })]);
    app.sync([session({ id: "a", activity: "idle" })]);
    app.sync([session({ id: "a", activity: "talking" })]);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS * 2);

    expect(app.notified).toEqual([]);
  });

  it("drops the finished notice when the session is closed while held", () => {
    const app = harness();
    app.sync([session({ id: "a", activity: "talking" })]);
    app.sync([session({ id: "a", activity: "idle" })]);
    app.sync([]);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS * 2);

    expect(app.notified).toEqual([]);
  });

  it("announces a pending choice immediately", () => {
    // 等待确认是稳定态，不存在抖动，压着只会白白让用户多等。
    const app = harness();
    app.sync([session({ id: "a", activity: "talking" })]);
    app.sync([session({ id: "a", activity: "awaiting-choice" })]);

    expect(app.notified).toEqual([{ title: "在等你确认", body: "belfry · 跑一遍测试" }]);
  });
});

describe("什么时候闭嘴", () => {
  it("says nothing on the first sight of a session", () => {
    // 恢复出来的会话、刚新建的会话都从这里进来，不该被当成刚刚跑完。
    const app = harness();
    app.sync([session({ id: "a", activity: "idle" })]);
    app.sync([session({ id: "b", activity: "awaiting-choice" })]);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS * 2);

    expect(app.notified).toEqual([]);
  });

  it("stays quiet when the user is looking right at the session", () => {
    const app = harness();
    const onStage = new Set(["a"]);
    app.sync([session({ id: "a", activity: "talking" })], onStage, true);
    app.sync([session({ id: "a", activity: "idle" })], onStage, true);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS);

    expect(app.notified).toEqual([]);
  });

  it("still notifies when the session is on stage but the window is in the background", () => {
    const app = harness();
    const onStage = new Set(["a"]);
    app.sync([session({ id: "a", activity: "talking" })], onStage, false);
    app.sync([session({ id: "a", activity: "idle" })], onStage, false);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS);

    expect(app.notified).toHaveLength(1);
  });

  it("still notifies when the window is focused but the session is off stage", () => {
    // 分屏里被别的窗格顶掉了，状态点用户看不见。
    const app = harness();
    const other = new Set(["b"]);
    app.sync([session({ id: "a", activity: "talking" })], other, true);
    app.sync([session({ id: "a", activity: "idle" })], other, true);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS);

    expect(app.notified).toHaveLength(1);
  });

  it("re-checks visibility at send time, not at decision time", () => {
    // 用户在确认窗口里回到了这条会话：通知已经没有意义了。
    const app = harness();
    app.sync([session({ id: "a", activity: "talking" })]);
    app.sync([session({ id: "a", activity: "idle" })]);
    app.sync([session({ id: "a", activity: "idle" })], new Set(["a"]), true);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS);

    expect(app.notified).toEqual([]);
  });

  it("never notifies for shell sessions", () => {
    const app = harness();
    app.sync([session({ id: "a", kind: "shell", activity: "talking" })]);
    app.sync([session({ id: "a", kind: "shell", activity: "idle" })]);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS);

    expect(app.notified).toEqual([]);
  });
});

describe("角标", () => {
  const latest = (badges: number[]) => badges[badges.length - 1];

  it("counts every session waiting on you", () => {
    const app = harness();
    app.sync([
      session({ id: "a", activity: "awaiting-choice" }),
      session({ id: "b", activity: "awaiting-choice" }),
      session({ id: "c", activity: "talking" }),
    ]);
    expect(latest(app.badges)).toBe(2);
  });

  it("clears a waiting session from the count once it is answered", () => {
    const app = harness();
    app.sync([session({ id: "a", activity: "awaiting-choice" })]);
    app.sync([session({ id: "a", activity: "talking" })]);
    expect(latest(app.badges)).toBe(0);
  });

  it("keeps a finished session counted until the user comes back to it", () => {
    const app = harness();
    app.sync([session({ id: "a", activity: "talking" })]);
    app.sync([session({ id: "a", activity: "idle" })]);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS);
    expect(latest(app.badges)).toBe(1);

    // 回到应用并且这条会话就在眼前 —— 角标该掉了。
    app.sync([session({ id: "a", activity: "idle" })], new Set(["a"]), true);
    expect(latest(app.badges)).toBe(0);
  });

  it("drops a finished session from the count when it is closed", () => {
    const app = harness();
    app.sync([session({ id: "a", activity: "talking" })]);
    app.sync([session({ id: "a", activity: "idle" })]);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS);
    expect(latest(app.badges)).toBe(1);

    app.sync([]);
    expect(latest(app.badges)).toBe(0);
  });

  it("adds waiting and unread-finished together", () => {
    const app = harness();
    app.sync([
      session({ id: "a", activity: "talking" }),
      session({ id: "b", activity: "idle" }),
    ]);
    app.sync([
      session({ id: "a", activity: "idle" }),
      session({ id: "b", activity: "awaiting-choice" }),
    ]);
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS);

    // a 跑完没人看，b 卡在等确认。
    expect(latest(app.badges)).toBe(2);
  });
});

describe("dispose", () => {
  it("cancels held notices so a closing window stays silent", () => {
    const app = harness();
    app.sync([session({ id: "a", activity: "talking" })]);
    app.sync([session({ id: "a", activity: "idle" })]);
    app.dispose();
    vi.advanceTimersByTime(FINISHED_CONFIRM_MS * 2);

    expect(app.notified).toEqual([]);
  });
});
