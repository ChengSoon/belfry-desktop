import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HookAgentCard, HookPreviewCard } from "./HookCards";
import { HookStatusBar } from "./HookStatusBar";
import type { AgentHookReport } from "./contracts";
import { statusReport } from "../../terminal/fixtures/programStatus";

const report: AgentHookReport = { kind: "antigravity", version: "1.5.3", supported: true,
  configPath: "/config/hooks.json", installed: 0, expected: 10, stale: 0, disabled: false, note: "尚未连接", error: null };

it("尚未安装时提供预览入口，不把已支持接口说成已连接", () => {
  const html = renderToStaticMarkup(<HookAgentCard report={report} busy={false} onPreview={() => {}} />);
  expect(html).toContain("预览启用 Antigravity CLI Hook");
  expect(html).toContain("/config/hooks.json");
  expect(html).not.toContain("已连接");
});

it("未知版本不能启用，但允许移除旧的托管 Hook", () => {
  const html = renderToStaticMarkup(<HookAgentCard report={{ ...report, supported: false, installed: 1 }} busy={false} onPreview={() => {}} />);
  expect(html).toMatch(/aria-label="预览启用 Antigravity CLI Hook"[^>]*disabled=""[^>]*>预览启用</);
  expect(html).toContain("预览移除 Antigravity CLI Hook");
});

it("预览展示准确路径和本次命令，并要求显式启用", () => {
  const html = renderToStaticMarkup(<HookPreviewCard busy={false} onCancel={() => {}} onConfirm={() => {}}
    preview={{ id: "review", kind: "antigravity", configPath: "/config/hooks.json", enabling: true,
      command: "'/app/Belfry' --belfry-hook antigravity", events: ["SessionStart", "Stop"], managedBefore: 0 }} />);
  expect(html).toContain("/config/hooks.json");
  expect(html).toContain("--belfry-hook antigravity");
  expect(html).toContain("确认启用");
  expect(html).toContain("取消");
});

it("未连接的终端明确标注推断，等待输入由 Hook 标注", () => {
  const fallback = renderToStaticMarkup(<HookStatusBar snapshot={null} activity="talking" phase="running" />);
  expect(fallback).toContain("屏幕推断");
  const connected = renderToStaticMarkup(<HookStatusBar activity="awaiting-choice" phase="running" snapshot={{
    sequence: 1, agent: "antigravity", session: { agent: "antigravity", id: "native-session" }, state: "awaiting_input",
    source: "hook", occurredAt: 1, reason: "等待确认或输入", transcriptPath: null,
  }} />);
  expect(connected).toContain("Hook");
  expect(connected).toContain("等待确认或输入");
  expect(connected).toContain("native-session");
});

it("恢复连接与初次启动使用不同文案，连接异常不误报启动失败", () => {
  const restoring = renderToStaticMarkup(<HookStatusBar snapshot={null} activity="idle" phase="creating" recovering />);
  expect(restoring).toContain("正在恢复会话");
  const failed = renderToStaticMarkup(<HookStatusBar snapshot={null} activity="idle" phase="error" />);
  expect(failed).toContain("会话异常");
  expect(failed).not.toContain("启动失败");
});

it.each(["codex", "claude"] as const)("%s 等待原生报告，不提供新的 Hook 安装入口", agent => {
  const html = renderToStaticMarkup(<HookStatusBar agent={agent} snapshot={null} activity="idle" phase="running" />);
  expect(html).toContain("OSC 7501");
  expect(html).toContain(agent === "claude" ? "等待 Claude Code 报告会话状态" : "等待 Codex 报告会话状态");
  expect(html).not.toContain("屏幕推断");
  expect(html).not.toContain("启用 Hook");
  const card = renderToStaticMarkup(<HookAgentCard report={{ ...report, kind: agent, installed: 1 }} busy={false} onPreview={() => {}} />);
  expect(card).toContain("原生终端状态");
  expect(card).not.toContain("预览启用");
  expect(card).toContain("预览移除");
});

it.each(["codex", "claude"] as const)("%s 原生空闲和完成显示不同状态", agent => {
  const idle = renderToStaticMarkup(<HookStatusBar agent={agent} snapshot={{ ...statusReport(agent, "idle"), reason: "本轮响应结束" }} activity="talking" phase="running" />);
  expect(idle).toContain("就绪");
  expect(idle).not.toContain("本轮响应结束");
  const done = renderToStaticMarkup(<HookStatusBar agent={agent} snapshot={statusReport(agent, "done")} activity="talking" phase="running" />);
  expect(done).toContain("本轮已完成");
});
