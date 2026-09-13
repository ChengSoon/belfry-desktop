import { expect, it, vi } from "vitest";
import { createWorkspaceTab } from "../tabs";
import { serializeWorkspaceState, parseWorkspaceState } from "../storage";
import { createProfile } from "./model";
import { configureProjectTab, runStartupOnce } from "./launch";

const project = { id: "qa", name: "中文 项目", rootPath: "/work/中文 项目", rootUri: "file:///work/中文%20项目" };
const profile = { ...createProfile(project), shell: "shell:bash" as const, command: "pnpm dev", env: { MODE: "test" } };

it("snapshots project settings and respects an explicitly selected shell", () => {
  const tab = createWorkspaceTab(project, "shell", 1);
  const configured = configureProjectTab(tab, profile, { explicit: true });
  expect(configured.profileId).toBe("shell:bash");
  expect(configured.projectLaunch?.startup?.command).toBe("pnpm dev");
  const override = configureProjectTab(tab, profile, { explicit: true, shell: "shell:zsh" });
  expect(override.profileId).toBe("shell:zsh");
  expect(configured.projectLaunch?.env).not.toBe(profile.env);
});

it("does not carry a command into persisted or restored workspaces", () => {
  const tab = configureProjectTab(createWorkspaceTab(project, "shell", 1), profile, { explicit: true });
  const saved = serializeWorkspaceState([tab], tab.id);
  expect(saved).not.toContain("pnpm dev");
  const restored = parseWorkspaceState(saved)!.tabs[0];
  expect(configureProjectTab(restored, profile, { explicit: false }).projectLaunch?.startup).toBeUndefined();
});

it("never applies local startup commands to SSH or Agent prompts", () => {
  const agent = configureProjectTab(createWorkspaceTab(project, "codex", 1), profile, { explicit: true });
  expect(agent.projectLaunch?.env).toEqual({ MODE: "test" });
  expect(agent.projectLaunch?.startup).toBeUndefined();
  const ssh = createWorkspaceTab(project, "ssh", 1);
  expect(configureProjectTab(ssh, profile, { explicit: true })).toBe(ssh);
});

it("rejects a different project's profile even when the caller reuses a stale selection", () => {
  const other = createWorkspaceTab({ ...project, rootPath: "/work/other", rootUri: "file:///work/other" }, "shell", 1);
  expect(configureProjectTab(other, profile, { explicit: true })).toBe(other);
});

it("ignores obsolete mounts, writes once to the current PTY, and never auto-retries an ambiguous failure", async () => {
  const intent = { command: "echo 中文" };
  const write = vi.fn().mockResolvedValue(undefined);
  await runStartupOnce({ intent, sessionId: "obsolete", current: () => false, write });
  expect(write).not.toHaveBeenCalled();
  await runStartupOnce({ intent, sessionId: "live", current: () => true, write });
  await runStartupOnce({ intent, sessionId: "restart", current: () => true, write });
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith("live", expect.any(Uint8Array));
  expect(new TextDecoder().decode(write.mock.calls[0][1])).toBe("echo 中文\r");
  const failed = { command: "pnpm dev" };
  const rejects = vi.fn().mockRejectedValue(new Error("connection lost"));
  await expect(runStartupOnce({ intent: failed, sessionId: "live", current: () => true, write: rejects })).rejects.toThrow();
  await runStartupOnce({ intent: failed, sessionId: "live", current: () => true, write: rejects });
  expect(rejects).toHaveBeenCalledTimes(1);
});
