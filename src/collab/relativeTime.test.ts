import { describe, expect, it } from "vitest";
import { formatTaskTime, formatTaskTimestamp } from "./relativeTime";

/** 本地时区构造，避免测试跟着 TZ 漂。月份 0 起算，8 = 九月。 */
function at(month: number, day: number, hour: number, minute: number, second = 0) {
  return new Date(2026, month, day, hour, minute, second).getTime();
}

const NOW = at(8, 3, 14, 30);

describe("formatTaskTime", () => {
  it("一分钟内是「刚刚」", () => {
    expect(formatTaskTime(NOW, NOW)).toBe("刚刚");
    expect(formatTaskTime(NOW - 59_000, NOW)).toBe("刚刚");
  });

  it("一小时内报分钟，向下取整", () => {
    expect(formatTaskTime(NOW - 60_000, NOW)).toBe("1 分钟前");
    expect(formatTaskTime(NOW - 119_000, NOW)).toBe("1 分钟前");
    expect(formatTaskTime(NOW - 59 * 60_000, NOW)).toBe("59 分钟前");
  });

  it("一到六小时报小时", () => {
    expect(formatTaskTime(at(8, 3, 13, 30), NOW)).toBe("1 小时前");
    expect(formatTaskTime(at(8, 3, 9, 5), NOW)).toBe("5 小时前");
  });

  it("小时档和时刻档的边界卡在 6 小时整", () => {
    // 5:59:59 还在小时档，向下取整成 5。
    expect(formatTaskTime(at(8, 3, 8, 30, 1), NOW)).toBe("5 小时前");
    // 正好 6 小时就落到时刻档。
    expect(formatTaskTime(at(8, 3, 8, 30), NOW)).toBe("08:30");
  });

  it("六小时以上但还在今天，报时刻", () => {
    expect(formatTaskTime(at(8, 3, 7, 15), NOW)).toBe("07:15");
  });

  it("凌晨看几小时前的活，报时长而不是「昨天」", () => {
    // 分档要是只到分钟就切时刻，01:24 看 3 小时前派的活会显示成「昨天 22:24」——
    // 语义没错，但读起来像隔了很久，而它其实才 3 小时。跨天就发生在凌晨，
    // 而凌晨恰恰是这工具用得最多的时段之一。
    const earlyMorning = at(8, 4, 1, 24);
    expect(formatTaskTime(at(8, 3, 22, 24), earlyMorning)).toBe("3 小时前");
  });

  it("跨天看的是日历日不是间隔小时数", () => {
    // 超过 6 小时之后才轮到日历日说话：凌晨 6:30 看昨天 22:30 派的活，
    // 间隔 8 小时、不到一天，但已经该报「昨天」了。
    const morning = at(8, 4, 6, 30);
    expect(formatTaskTime(at(8, 3, 22, 30), morning)).toBe("昨天 22:30");
  });

  it("更早只报月日", () => {
    expect(formatTaskTime(at(7, 28, 22, 30), NOW)).toBe("8-28");
    // 个位月日不补零：窄栏里 8-28 比 08-28 省一格，也不需要对齐。
    expect(formatTaskTime(at(6, 9, 1, 5), NOW)).toBe("7-9");
  });

  it("createdAt 是毫秒不是秒", () => {
    // 真源是 server.rs 的 as_millis()。当成秒解析的话 5 分钟前会被读成 1970 年，
    // 这条断言就是拿来钉死这个契约的。
    expect(formatTaskTime(NOW - 5 * 60_000, NOW)).toBe("5 分钟前");
  });

  it("时钟对不齐导致的未来时间不显示负数", () => {
    expect(formatTaskTime(NOW + 30_000, NOW)).toBe("刚刚");
  });
});

describe("formatTaskTimestamp", () => {
  it("补零到秒", () => {
    expect(formatTaskTimestamp(at(8, 3, 14, 2, 31))).toBe("2026-09-03 14:02:31");
  });
});
