import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { NewSessionMenu } from "../../../workspace/components/NewSessionMenu";
import { QuickOpen } from "../../../quickopen/QuickOpen";
import type { QuickOpenItem } from "../../../quickopen/model";
import type { ShellProfile } from "../../../terminal/contracts";
import { Presence } from "../../motion/Presence";
import "../../../styles.css";

// Real components with synthetic callbacks only; no native calls or user data.
const profiles: ShellProfile[] = [
  { id: "system-default", available: true, isDefault: true, executable: "/qa/shell", reason: null },
  { id: "shell:fish", available: false, isDefault: false, executable: null, reason: "QA unavailable" },
  { id: "shell:bash", available: true, isDefault: false, executable: "/qa/bash", reason: null },
];
const items: QuickOpenItem[] = [
  { id: "one", kind: "action", title: "First action", subtitle: "QA" },
  { id: "disabled", kind: "action", title: "Disabled action", subtitle: "QA", disabled: true },
  { id: "two", kind: "action", title: "Second action", subtitle: "QA" },
];
const qa = {
  refreshCalls: 0, launches: [] as string[], selections: [] as string[],
  release: (_failure = false) => {},
};
Object.assign(window, { __interactionQA: qa });
function Harness() {
  const [open, setOpen] = useState(false);
  const [allDisabled, setAllDisabled] = useState(false);
  const [mounted, setMounted] = useState(true);
  return <main style={{ padding: 40 }}>
    <div className="sidebar" style={{ height: 240, padding: 16 }}>
      {mounted && <NewSessionMenu agents={[]} shellProfiles={profiles} shellShortcut="⌘T"
        onLaunch={(kind, profile) => qa.launches.push(`${kind}:${profile}`)} onLaunchSsh={() => {}}
        onRefresh={() => { qa.refreshCalls++; return new Promise<void>((resolve, reject) => {
          qa.release = (failure = false) => failure ? reject(new Error("QA detection failed")) : resolve();
        }); }} />}
    </div>
    <button id="outside">Outside</button>
    <button id="unmount-menu" onClick={() => setMounted(false)}>Unmount menu</button>
    <button id="open" onClick={() => setOpen(value => !value)}>Quick Open</button>
    <button id="disable-options" onClick={() => setAllDisabled(true)}>Disable options</button>
    <Presence open={open}><QuickOpen shortcutLabel="⌘K" items={allDisabled ? items.map(item => ({ ...item, disabled: true })) : items}
      onClose={() => setOpen(false)} onSelect={item => { qa.selections.push(item.id); setOpen(false); }} /></Presence>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
