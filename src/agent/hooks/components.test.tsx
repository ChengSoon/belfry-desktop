import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HookAgentCard, HookPreviewCard } from "./HookCards";
import { HookStatusBar } from "./HookStatusBar";
import type { AgentHookReport } from "./contracts";

const report: AgentHookReport = { kind: "codex", version: "codex-cli 0.154.0", supported: true,
  configPath: "/config/hooks.json", installed: 0, expected: 10, stale: 0, disabled: false, note: "尚未连接", error: null };

it("尚未安装时提供预览入口，不把已支持接口说成已连接", () => {
  const html = renderToStaticMarkup(<HookAgentCard report={report} busy={false} onPreview={() => {}} />);
  expect(html).toContain("预览启用 Codex Hook");
  expect(html).toContain("/config/hooks.json");
  expect(html).not.toContain("已连接");
});

it("未知版本不能启用，但允许移除旧的托管 Hook", () => {
  const html = renderToStaticMarkup(<HookAgentCard report={{ ...report, supported: false, installed: 1 }} busy={false} onPreview={() => {}} />);
  expect(html).toMatch(/disabled=""[^>]*>预览启用 Codex Hook/);
  expect(html).toContain("预览移除 Codex Hook");
});

it("预览展示准确路径和本次命令，并要求显式启用", () => {
  const html = renderToStaticMarkup(<HookPreviewCard busy={false} onCancel={() => {}} onConfirm={() => {}}
    preview={{ id: "review", kind: "codex", configPath: "/config/hooks.json", enabling: true,
      command: "'/app/Belfry' --belfry-hook codex", events: ["SessionStart", "Stop"], managedBefore: 0 }} />);
  expect(html).toContain("/config/hooks.json");
  expect(html).toContain("--belfry-hook codex");
  expect(html).toContain("确认启用");
  expect(html).toContain("取消");
  expect(html).toContain("/hooks");
});

it("未连接的终端明确标注推断，等待输入由 Hook 标注", () => {
  const fallback = renderToStaticMarkup(<HookStatusBar snapshot={null} activity="talking" phase="running" />);
  expect(fallback).toContain("屏幕推断");
  const connected = renderToStaticMarkup(<HookStatusBar activity="awaiting-choice" phase="running" snapshot={{
    sequence: 1, agent: "codex", session: { agent: "codex", id: "native-session" }, state: "awaiting_input",
    source: "hook", occurredAt: 1, reason: "等待确认或输入", transcriptPath: null,
  }} />);
  expect(connected).toContain("Hook");
  expect(connected).toContain("等待确认或输入");
  expect(connected).toContain("native-session");
});
