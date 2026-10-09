import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { TerminalStage } from "../../../layout/components/TerminalStage";
import { useSessionDrag, type SessionDrag } from "../../../layout/useSessionDrag";
import type { WorkspaceTab } from "../../../workspace/contracts";
import type { TerminalSnapshot } from "../../TerminalViewport";
import type { DropEdge } from "../../../layout/contracts";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { TypographyProvider } from "../../../typography/TypographyProvider";
import { BackgroundProvider } from "../../../background/BackgroundProvider";

// Mounted production components, synthetic tabs/native IPC only. No App, timers,
// snapshot-driven tab updates or StrictMode double renders in this bounded probe.
const tabs: WorkspaceTab[] = ["A", "B", "C"].map((id) => ({
  id, title: id, titleHint: null, customTitle: null, agentName: null,
  project: { id: "perf", name: "perf", rootPath: "/qa/perf", rootUri: "file:///qa/perf" },
  kind: "shell", profileId: "system-default", collaborationMode: false,
  sshTarget: null, resumeSessionId: null, phase: "running", activity: "idle", error: null,
}));
const full = { left: 0, top: 0, width: 100, height: 100 };
const noop = () => {};
const qa = {
  terminals: {} as Record<string, number>, commits: 0, dragCommits: 0,
  drag: null as SessionDrag | null, drops: [] as [string, string, DropEdge][], ejects: [] as string[],
  snapshots: {} as Record<string, TerminalSnapshot>, canEject: true,
};
const handlers = {
  onDrop: (id: string, target: string, edge: DropEdge) => { qa.drops.push([id, target, edge]); },
  onEject: (id: string) => { qa.ejects.push(id); },
  canEject: () => qa.canEject,
};
const onSnapshot = (id: string, value: TerminalSnapshot) => { qa.snapshots[id] = value; };
let consume: () => boolean = () => false;

function Harness() {
  const [active, setActive] = useState("A");
  const [sidebar, setSidebar] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null), sidebarRef = useRef<HTMLElement>(null);
  const panes = useMemo(() => [{ tabId: active, rect: full }], [active]);
  const rects = useMemo(() => new Map(panes.map((pane) => [pane.tabId, pane.rect])), [panes]);
  const { drag, startDrag, consumedClick } = useSessionDrag(stageRef, sidebarRef, panes, handlers);
  consume = consumedClick;
  useLayoutEffect(() => { qa.commits++; if (drag) qa.dragCommits++; qa.drag = drag; });
  return <>
    <nav style={{ height: 40 }}>
      <button id="toggle" onClick={() => setSidebar((open) => !open)}>Sidebar</button>
      {tabs.map((tab) => <button id={`switch-${tab.id}`} key={tab.id} onClick={() => setActive(tab.id)}>{tab.id}</button>)}
    </nav>
    <main style={{ display: "flex", height: 600, width: "100%" }}>
      {sidebar && <aside ref={sidebarRef} style={{ width: 240, flexShrink: 0 }}>
        {tabs.map((tab) => <button id={`drag-${tab.id}`} key={tab.id}
          onPointerDown={(event) => startDrag(tab.id, event)}>{tab.id}</button>)}
      </aside>}
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <TerminalStage tabs={tabs} rects={rects} dividers={[]} split={false} activeTabId={active}
          stageRef={stageRef} drag={drag} onFocus={setActive} onClosePane={noop}
          onDragStart={startDrag} onResize={noop} onOpenFile={noop} onSnapshot={onSnapshot} onCommandTarget={noop} />
      </div>
    </main>
  </>;
}

const root = createRoot(document.getElementById("root")!);
// Keep one mutable object shared by the transform-only SessionTerminal counter.
Object.assign(window, { __perf: qa, __perfAPI: {
  reset() { qa.terminals = {}; qa.commits = 0; qa.dragCommits = 0; qa.drops = []; qa.ejects = []; },
  consume: () => consume(),
  unmount: () => flushSync(() => root.unmount()),
  // flushSync prevents React automatic batching from disguising the hook's own
  // per-event setState. RAF remains the real browser RAF, never a fake clock.
  pointer(type: string, x: number, y: number, selector?: string, button = 0) {
    flushSync(() => (selector ? document.querySelector(selector)! : document).dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, button, pointerId: 1, bubbles: true, cancelable: true }),
    ));
  },
} });
root.render(<ThemeProvider><TypographyProvider><BackgroundProvider><Harness /></BackgroundProvider></TypographyProvider></ThemeProvider>);
