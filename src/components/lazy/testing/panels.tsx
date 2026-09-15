import { useEffect, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { AppOverlays } from "../../AppOverlays";
import { BackgroundProvider } from "../../../background/BackgroundProvider";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { TypographyProvider } from "../../../typography/TypographyProvider";
import { INITIAL_UPDATER_STATE } from "../../../updater/contracts";
import { USAGE_WIDTH } from "../../../usage/usageWidth";
import { createOptionalPanel } from "../OptionalPanel";
import "./panelApi";
import "../../../styles.css";
import "../../../workspace/workspace.css";
import "../../../panel/panelShell.css";
import "../../../settings/settingsShell.css";

const qa = { mounted: 0, unmounted: 0, ticks: 0, loadCalls: 0,
  release: () => {}, reject: () => {}, open: (_name: string) => {} };
Object.assign(window, { qa });
const Delayed = createOptionalPanel({ title: "测试面板", layout: "usage", width: USAGE_WIDTH,
  load: () => {
    qa.loadCalls++;
    return new Promise<typeof import("./DeferredPanel")>((resolve, reject) => {
      qa.release = () => { void import("./DeferredPanel").then(resolve, reject); };
      qa.reject = () => reject(new Error("simulated network failure"));
    });
  } });
const Network = createOptionalPanel({ title: "网络面板", layout: "usage", width: USAGE_WIDTH,
  load: () => import("./DeferredPanel") });
let attemptedStyles = false;
const Styled = createOptionalPanel({ title: "样式面板", layout: "usage", width: USAGE_WIDTH,
  load: async () => {
    if (!attemptedStyles) {
      attemptedStyles = true;
      await new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet"; link.href = `${location.origin}/__panel-styles.css`;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`Unable to preload CSS for ${link.href}`));
        document.head.append(link);
      });
    }
    return import("./DeferredPanel");
  } });
const noop = () => {};
const defaults: ComponentProps<typeof AppOverlays> = {
  failure: null, historyOpen: false, pendingClose: null, pendingRemove: null, pendingRemoveTabCount: 0,
  project: null, quickOpenItems: [], quickOpenOpen: false, quickOpenShortcut: "⌘K", settingsOpen: false,
  shortcutGuideOpen: false, shortcutPlatform: "macos", updaterOpen: false,
  updaterState: INITIAL_UPDATER_STATE, usageOpen: false,
  onCancelClose: noop, onCancelRemove: noop, onCheckUpdate: noop, onCloseHistory: noop,
  onCloseQuickOpen: noop, onCloseSettings: noop, onCloseShortcutGuide: noop, onCloseUpdater: noop,
  onCloseUsage: noop, onConfirmClose: noop, onConfirmRemove: noop, onDismissFailure: noop,
  onInstallUpdate: noop, onResumeHistory: noop, onSelectQuickOpen: noop,
};

function PersistentWorkbench() {
  useEffect(() => {
    qa.mounted++;
    const timer = setInterval(() => { qa.ticks++; }, 10);
    return () => { qa.unmounted++; clearInterval(timer); };
  }, []);
  return <div className="workbench"><input id="terminal-input" aria-label="终端输入" defaultValue="keep my input" /></div>;
}

function Panels() {
  const [open, setOpen] = useState("");
  qa.open = setOpen;
  const close = () => setOpen("");
  return <main className={`app-shell${open === "settings" ? " is-settings" : ""}${["usage", "history", "delayed", "network"].includes(open) ? ` has-${open === "history" ? "history" : "usage"}` : ""}`}>
    <aside className="sidebar" style={{ width: 180 }}>{["settings", "history", "usage", "quickOpen", "shortcutGuide", "updater", "delayed", "network"].map((name) =>
      <button key={name} id={`open-${name}`} onClick={() => setOpen(name)} type="button">{name}</button>)}</aside>
    <PersistentWorkbench />
    <AppOverlays {...defaults} settingsOpen={open === "settings"} historyOpen={open === "history"}
      usageOpen={open === "usage"} quickOpenOpen={open === "quickOpen"} shortcutGuideOpen={open === "shortcutGuide"}
      updaterOpen={open === "updater"} onCloseSettings={close} onCloseHistory={close} onCloseUsage={close}
      onCloseQuickOpen={close} onCloseShortcutGuide={close} onCloseUpdater={close} />
    {open === "delayed" ? <Delayed onClose={close} /> : null}
    {open === "network" ? <Network onClose={close} /> : null}
    {open === "styled" ? <Styled onClose={close} /> : null}
  </main>;
}

createRoot(document.getElementById("root")!).render(<ThemeProvider><TypographyProvider><BackgroundProvider>
  <Panels />
</BackgroundProvider></TypographyProvider></ThemeProvider>);
