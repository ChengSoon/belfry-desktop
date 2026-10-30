import { describe, expect, it } from "vitest";
import type { PendingReview } from "./api";
import { ReviewNotifier } from "./reviewNotifier";

function review(taskId: string): PendingReview {
  return { roomId: "r-1", roomName: "发布检查", taskId, title: "统一登录失败的错误提示" };
}

describe("ReviewNotifier", () => {
  it("首次同步只做基线：启动时已有的待验证不弹通知", () => {
    const sent: PendingReview[] = [];
    const notifier = new ReviewNotifier({ notify: (item) => sent.push(item), quiet: () => false });
    notifier.sync([review("t-1"), review("t-2")]);
    expect(sent).toEqual([]);
    notifier.sync([review("t-1"), review("t-2")]);
    expect(sent).toEqual([]);
  });

  it("新进入待验证的只提醒一次", () => {
    const sent: PendingReview[] = [];
    const notifier = new ReviewNotifier({ notify: (item) => sent.push(item), quiet: () => false });
    notifier.sync([]);
    notifier.sync([review("t-1")]);
    notifier.sync([review("t-1")]);
    expect(sent.map((item) => item.taskId)).toEqual(["t-1"]);
  });

  it("用户正看着房间时不打扰，也不留迟到的补发", () => {
    const sent: PendingReview[] = [];
    let quiet = true;
    const notifier = new ReviewNotifier({ notify: (item) => sent.push(item), quiet: () => quiet });
    notifier.sync([]);
    notifier.sync([review("t-1")]);
    expect(sent).toEqual([]);
    quiet = false;
    notifier.sync([review("t-1")]);
    expect(sent).toEqual([]);
  });

  it("验证或退回后从清单消失；编号再次出现按新的一条处理", () => {
    const sent: PendingReview[] = [];
    const notifier = new ReviewNotifier({ notify: (item) => sent.push(item), quiet: () => false });
    notifier.sync([]);
    notifier.sync([review("t-1")]);
    notifier.sync([]);
    notifier.sync([review("t-1")]);
    // 正常路径里任务不会回到待验证；真发生了也宁可多响一次，不可漏。
    expect(sent.map((item) => item.taskId)).toEqual(["t-1", "t-1"]);
  });
});
