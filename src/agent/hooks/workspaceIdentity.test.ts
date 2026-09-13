import { expect, it } from "vitest";
import { createWorkspaceTab, applySnapshot } from "../../workspace/tabs";
import { parseWorkspaceState, serializeWorkspaceState } from "../../workspace/storage";
import type { HookSnapshot } from "./contracts";

const project = { id: "project", name: "project", rootPath: "/tmp/project", rootUri: "file:///tmp/project" };
const hook: HookSnapshot = { agent: "codex", session: { agent: "codex", id: "native-new" }, state: "processing",
  source: "hook", sequence: 1, occurredAt: 1, reason: "处理", transcriptPath: "/private/log.jsonl" };

it("Hook 身份更新存档，但不改变正在运行的启动参数", () => {
  const tab = createWorkspaceTab(project, "codex", 1);
  const next = applySnapshot(tab, { phase: "running", error: null, lastInput: null, activity: "talking", agentState: hook });
  expect(next.agentSessionRef).toEqual({ agent: "codex", id: "native-new" });
  expect(next.resumeSessionId).toBeNull();
  const saved = serializeWorkspaceState([next], next.id);
  expect(saved).not.toContain("/private/log.jsonl");
  expect(parseWorkspaceState(saved)?.tabs[0].resumeSessionId).toBe("native-new");
});

it("CLI 内切换会话后，重开恢复最新身份且不会丢弃整个 tab", () => {
  const tab = createWorkspaceTab(project, "codex", 1, "native-old");
  const next = applySnapshot(tab, { phase: "running", error: null, lastInput: null, activity: "talking", agentState: hook });
  expect(next.resumeSessionId).toBe("native-old");
  const restored = parseWorkspaceState(serializeWorkspaceState([next], next.id));
  expect(restored?.tabs).toHaveLength(1);
  expect(restored?.tabs[0].agentSessionRef?.id).toBe("native-new");
});
