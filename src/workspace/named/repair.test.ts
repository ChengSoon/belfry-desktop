import { expect, it, vi } from "vitest";
import { createWorkspaceTab } from "../tabs";
import type { WorkspaceTab } from "../contracts";
import { canRepairProject, repairTabProject, requestProjectRepair } from "./repair";

const oldProject = { id: "old", name: "旧目录", rootPath: "/gone", rootUri: "file:///gone" };
const nextProject = { id: "new", name: "新目录", rootPath: "/中文 目录", rootUri: "file:///%E4%B8%AD%E6%96%87%20%E7%9B%AE%E5%BD%95" };
const tab = { ...createWorkspaceTab(oldProject, "codex", 1), id: "keep-id", phase: "error" as const,
  resumeSessionId: "native-id", agentSessionRef: { agent: "codex" as const, id: "native-id" } };

it("修复已停止会话的目录保留会话 ID、CLI 历史身份和启动参数", () => {
  const repaired = repairTabProject(tab, nextProject);
  expect(repaired).toMatchObject({ id: "keep-id", resumeSessionId: "native-id", agentSessionRef: tab.agentSessionRef,
    profileId: "agent:codex", project: nextProject, phase: "idle", error: null });
  expect(tab.project).toBe(oldProject);
});

it("运行中、正在启动和尚未启动的会话都不允许换目录，SSH 由连接设置处理", () => {
  for (const phase of ["idle", "creating", "running"] as const) {
    expect(canRepairProject({ ...tab, phase })).toBe(false);
    expect(() => repairTabProject({ ...tab, phase }, nextProject)).toThrow("已停止");
  }
  expect(canRepairProject({ ...tab, kind: "ssh" })).toBe(false);
});

it("目录选择取消、空路径和会话在等待期间重启时都不改写会话", async () => {
  const apply = vi.fn(), open = vi.fn(async () => nextProject);
  let current: WorkspaceTab = tab;
  const ports = { current: () => current, open, apply };
  await requestProjectRepair(null, ports);
  await expect(requestProjectRepair("  ", ports)).rejects.toThrow("目录");
  expect(open).not.toHaveBeenCalled();
  const pending = requestProjectRepair("/new", ports);
  current = { ...tab, phase: "running" };
  await expect(pending).rejects.toThrow("已停止");
  expect(apply).not.toHaveBeenCalled();
});

it("目录在对话框打开期间已被修复或会话被关闭时拒绝覆盖", async () => {
  let current: typeof tab | null = tab;
  const apply = vi.fn();
  const ports = { current: () => current, open: async () => { current = null; return nextProject; }, apply };
  await expect(requestProjectRepair("/new", ports)).rejects.toThrow("不存在");
  expect(apply).not.toHaveBeenCalled();
});

it("修复目录不沿用旧项目的环境或尚未发送的启动命令", () => {
  const previous = { ...tab, projectLaunch: { env: { MODE: "old" }, startup: { command: "pnpm dev" } } };
  expect(repairTabProject(previous, nextProject).projectLaunch).toBeUndefined();
});
