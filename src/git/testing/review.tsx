import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PromptDeliveryOptions, PromptDeliveryResult, SessionActivity, TerminalCommandTarget } from "../../terminal/contracts";
import type { WorkspaceTab } from "../../workspace/contracts";
import { usePromptQueue } from "../../prompt/usePromptQueue";
import { GitPanel } from "../GitPanel";
import { GitReviewProvider } from "../review/GitReviewProvider";
import "../../styles.css";
import "../../components/controls/controls.css";

const project = { id: "review-project", name: "Review fixture", rootPath: "/qa/worktree", rootUri: "file:///qa/worktree" };
const filename = "src/示例 文件.ts";
const patch = "diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -3,2 +3,2 @@\n-const result = items[0];\n+const result = items.at(0);\n return result;\n";
const makeTab = (id: string, fields: Partial<WorkspaceTab> = {}): WorkspaceTab => ({ id, project, kind: "codex", title: id,
  titleHint: null, customTitle: null, agentName: id, profileId: "agent:codex", collaborationMode: false,
  sshTarget: null, resumeSessionId: null, phase: "running", activity: "idle", error: null, ...fields });
const initialTabs = [makeTab("reviewer"), makeTab("builder", { kind: "claude", profileId: "agent:claude", activity: "talking" }),
  makeTab("other-worktree", { project: { ...project, rootPath: "/qa/other-worktree" } }),
  makeTab("shell", { kind: "shell", profileId: "system-default" })];

// Real panel/provider/queue, synthetic disk and terminal boundaries. No user files, PTYs or agents are touched.
const qa = {
  patch, filename, readFailure: false, holdRead: false, writes: [] as { id: string; text: string }[], errors: [] as string[],
  tabs: initialTabs, activations: [] as string[], delivery: "hold",
  complete: (_result: PromptDeliveryResult) => {}, releaseRead: () => {},
  setActivity: (_id: string, _activity: SessionActivity) => {}, remove: (_id: string) => {},
};
window.addEventListener("error", (event) => qa.errors.push(String(event.error ?? event.message)));
window.addEventListener("unhandledrejection", (event) => qa.errors.push(String(event.reason)));
Object.assign(window, { __reviewQA: qa, __TAURI_INTERNALS__: { invoke: async (command: string) => {
  if (command === "git_status") return { repository: true, rootPath: project.rootPath, branch: "feature/review", head: "123abc",
    upstream: null, ahead: 0, behind: 0, truncated: false, entries: [filename, "src/another.ts"].map((path) => ({ path,
      originalPath: null, indexStatus: ".", worktreeStatus: "M", untracked: false, conflicted: false, submodule: false })) };
  if (command === "git_diff") {
    if (qa.holdRead) { qa.holdRead = false; await new Promise<void>((resolve) => { qa.releaseRead = resolve; }); }
    if (qa.readFailure) throw new Error("Synthetic disk unavailable");
    return { text: qa.patch, binary: false, truncated: false };
  }
  throw new Error(`Unexpected fixture command ${command}`);
} } });
const targets = new Map<string, TerminalCommandTarget>(initialTabs.map((tab) => [tab.id, {
  focus: () => {}, sendText: (text: string, options?: PromptDeliveryOptions) => {
    qa.writes.push({ id: tab.id, text });
    qa.complete = (result) => options?.onResult?.(result);
    if (qa.delivery === "auto") queueMicrotask(() => options?.onResult?.("submitted"));
    return true;
  },
}]));

function Fixture() {
  const [tabs, setTabs] = useState(initialTabs);
  const [open, setOpen] = useState(true);
  qa.tabs = tabs;
  qa.setActivity = (id, activity) => setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, activity } : tab));
  qa.remove = (id) => setTabs((current) => current.filter((tab) => tab.id !== id));
  const queue = usePromptQueue({ tabs, targets });
  return <main style={{ padding: 16, display: "grid", gap: 12 }}>
    <button id="toggle-review" style={{ justifySelf: "start" }} onClick={() => setOpen((value) => !value)}>切换 Git 面板</button>
    <GitReviewProvider tabs={tabs} activeTabId="reviewer" submit={queue.submit} cancel={queue.cancel}
      onActivate={(id) => qa.activations.push(id)}>
      <div style={{ display: "flex", width: "min(520px, calc(100vw - 32px))", height: "calc(100vh - 70px)" }}>
        {open ? <GitPanel project={project} onClose={() => setOpen(false)} onFiles={() => {}} onOpenFile={() => {}} /> : null}
      </div>
    </GitReviewProvider>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
