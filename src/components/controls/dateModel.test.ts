import { describe, expect, it } from "vitest";
import { calendarDays, dateFromParts, dateParts, moveDate, moveMonth, todayDate } from "./dateModel";

describe("不依赖时区的日期选择", () => {
  it("拒绝无效日期，保留闰年与四位年份", () => {
    expect(dateParts("2025-02-29")).toBeNull();
    expect(dateParts("2026-13-01")).toBeNull();
    expect(dateParts("0000-01-01")).toBeNull();
    expect(dateParts("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(dateFromParts({ year: 9, month: 1, day: 1 })).toBe("0009-01-01");
  });
  it("跨年、闰日与月底导航不发生溢出", () => {
    expect(moveDate("2025-12-31", 1)).toBe("2026-01-01");
    expect(moveDate("0001-01-01", -1)).toBe("0001-01-01");
    expect(moveMonth("2024-01-31", 1)).toBe("2024-02-29");
    expect(moveMonth("2024-02-29", 12)).toBe("2025-02-28");
    expect(moveMonth("9999-12-31", 1)).toBe("9999-12-31");
  });
  it("以周一开始六周网格，包含相邻月份", () => {
    const days = calendarDays("2026-09-12");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-08-31");
    expect(days[41]).toBe("2026-10-11");
  });
  it("UTC 今天不会转换成前一天", () => {
    expect(todayDate("utc", new Date("2026-09-12T00:01:00Z"))).toBe("2026-09-12");
  });
});
