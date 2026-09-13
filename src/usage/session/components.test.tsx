import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StatisticsBody } from "./StatisticsBody";
import type { SessionStatistics } from "./contracts";

const report: SessionStatistics = { session: { agent: "claude", id: "native" },
  tokens: { input: 10, cachedInput: 20, cacheWrite: null, output: 4 }, models: ["claude-test"], currentModel: "claude-test",
  tools: [{ name: "Bash", calls: 2 }], toolCount: 2, updatedAt: null, observedAt: 1,
  sourceFiles: 1, scannedBytes: 100, pending: false, skippedLines: 0, note: null };

it("按四类 Token 展示，缺失的缓存写入与时间标为不可用", () => {
  const html = renderToStaticMarkup(<StatisticsBody bound state={{ report, loading: false, error: null }} />);
  for (const text of ["新增输入", "缓存读取", "缓存写入", "输出", "不可用", "claude-test", "Bash", "2 次", "日志未记录时间"]) {
    expect(html).toContain(text);
  }
  expect(html).not.toContain("总计 34");
});

it("没有原生身份时解释获取统计的前提", () => {
  const html = renderToStaticMarkup(<StatisticsBody bound={false} state={{ report: null, loading: false, error: null }} />);
  expect(html).toContain("尚未绑定原生会话");
  expect(html).toContain("会话状态");
});

it("大日志继续读取和损坏记录都有可见提示", () => {
  const html = renderToStaticMarkup(<StatisticsBody bound state={{ loading: false, error: null,
    report: { ...report, pending: true, note: "跳过 2 条损坏记录，合计可能不完整" } }} />);
  expect(html).toContain("继续读取");
  expect(html).toContain("合计可能不完整");
});
