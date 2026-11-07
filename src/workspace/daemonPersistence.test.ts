import { describe, expect, it } from "vitest";
import { parseWorkspaceState, serializeWorkspaceState } from "./storage";
import { applySnapshot, createWorkspaceTab } from "./tabs";

const project = { id: "qa", name: "后台验收", rootPath: "/tmp/qa", rootUri: "file:///tmp/qa" };
const daemonSessionId = "01k53f00pnpzqteyx6k99pf26x";

describe("daemon workspace identity", () => {
  it("restores the exact PTY identity without persisting a live connection credential", () => {
    const tab = { ...createWorkspaceTab(project, "shell", 1), daemonSessionId };
    const raw = serializeWorkspaceState([tab], tab.id);
    expect(raw).not.toContain("restoreSessionId");
    const restored = parseWorkspaceState(raw)!.tabs[0];
    expect(restored.daemonSessionId).toBe(daemonSessionId);
    expect(restored.restoreSessionId).toBe(daemonSessionId);
    expect(restored.phase).toBe("idle");
  });

  it("keeps the mount identity stable while new snapshots save the daemon identity", () => {
    const tab = createWorkspaceTab(project, "shell", 1);
    const running = applySnapshot(tab, { phase: "running", activity: "idle", error: null, lastInput: null, daemonSessionId });
    expect(running.daemonSessionId).toBe(daemonSessionId);
    expect(running.restoreSessionId).toBeUndefined();
    const creating = applySnapshot(running, { phase: "creating", activity: "idle", error: null, lastInput: null });
    expect(creating.daemonSessionId).toBe(daemonSessionId);
  });

  it("clears a missing PTY from storage without discarding the Agent's native history", () => {
    const tab = { ...createWorkspaceTab(project, "codex", 1, "native-history"), daemonSessionId,
      restoreSessionId: daemonSessionId };
    const lost = applySnapshot(tab, { phase: "creating", activity: "idle", error: null,
      lastInput: null, daemonSessionId: null });
    expect(lost.restoreSessionId).toBe(daemonSessionId); // 不因保存快照重新挂载终端。
    const restored = parseWorkspaceState(serializeWorkspaceState([lost], lost.id))!.tabs[0];
    expect(restored.daemonSessionId).toBeNull();
    expect(restored.restoreSessionId).toBeNull();
    expect(restored.resumeSessionId).toBe("native-history");
  });

  it("saves a native identity learned without Hooks and resumes it after reopening", () => {
    const tab = { ...createWorkspaceTab(project, "codex", 1), daemonSessionId };
    const identity = { agent: "codex" as const, id: "native-from-mcp" };
    const running = applySnapshot(tab, { phase: "running", activity: "idle", error: null,
      lastInput: null, agentState: null, agentSessionRef: identity });
    expect(running.agentSessionRef).toEqual(identity);
    expect(running.resumeSessionId).toBeNull(); // 身份入档不能触发当前终端重新挂载。
    const restored = parseWorkspaceState(serializeWorkspaceState([running], running.id))!.tabs[0];
    expect(restored.resumeSessionId).toBe(identity.id);
    expect(restored.agentSessionRef).toEqual(identity);
    expect(restored.restoreSessionId).toBe(daemonSessionId);
  });

  it("keeps the latest native identity through a lost attachment and rejects another Agent's identity", () => {
    const tab = createWorkspaceTab(project, "codex", 1, "initial-history");
    const identity = { agent: "codex" as const, id: "latest-history" };
    const running = applySnapshot(tab, { phase: "running", activity: "idle", error: null,
      lastInput: null, agentSessionRef: identity });
    const lost = applySnapshot(running, { phase: "creating", activity: "idle", error: null,
      lastInput: null, daemonSessionId: null, agentState: null, agentSessionRef: null });
    const foreign = applySnapshot(lost, { phase: "creating", activity: "idle", error: null,
      lastInput: null, agentSessionRef: { agent: "claude", id: "foreign-history" } });
    const restored = parseWorkspaceState(serializeWorkspaceState([foreign], foreign.id))!.tabs[0];
    expect(restored.resumeSessionId).toBe(identity.id);
    expect(foreign.resumeSessionId).toBe("initial-history");
  });

  it("ignores a malformed identity while retaining the user's session definition", () => {
    const tab = { ...createWorkspaceTab(project, "shell", 1), daemonSessionId: "../../private" };
    const restored = parseWorkspaceState(JSON.stringify({ tabs: [tab], activeTabId: tab.id }))!.tabs[0];
    expect(restored.daemonSessionId).toBeNull();
    expect(restored.restoreSessionId).toBeNull();
    expect(restored.id).toBe(tab.id);
  });
});
