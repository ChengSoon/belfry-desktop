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

  it("ignores a malformed identity while retaining the user's session definition", () => {
    const tab = { ...createWorkspaceTab(project, "shell", 1), daemonSessionId: "../../private" };
    const restored = parseWorkspaceState(JSON.stringify({ tabs: [tab], activeTabId: tab.id }))!.tabs[0];
    expect(restored.daemonSessionId).toBeNull();
    expect(restored.restoreSessionId).toBeNull();
    expect(restored.id).toBe(tab.id);
  });
});
