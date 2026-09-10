import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTheme } from "../theme/ThemeProvider";
import { pluginHost } from "./useDirectoryRegistry";
import { PluginThemeController } from "./PluginThemeController";
import { usePluginShortcuts } from "./workspace/usePluginWorkspace";
import { PluginLauncher } from "./workspace/PluginLauncher";
import { useClipboardCapture } from "./clipboardCapture";
import { usePluginRuntime } from "./usePluginRuntime";
import { usePluginTheme } from "./pluginTheme";
import { pluginAppearance } from "./appearance";
import "./pluginBridge.css";

export { pluginNotice } from "./notices";
export function PluginRuntimeBridge({ workspacePath, sessionId }: { workspacePath?: string; sessionId: string | null }) {
  const theme = useTheme();
  const selectedTheme = usePluginTheme(), runtime = usePluginRuntime();
  const activeTheme = runtime.themes.find((item) => `${item.pluginId}:${item.id}` === selectedTheme);
  const appearance = useMemo(() => pluginAppearance(theme, selectedTheme, activeTheme),
    [theme.mode, theme.pinned, selectedTheme, activeTheme?.id, activeTheme?.base, activeTheme?.css]);
  const [notice, setNotice] = useState("");
  usePluginShortcuts();
  useClipboardCapture();
  useEffect(() => {
    document.documentElement.dataset.pluginWorkspace = workspacePath ?? "";
    window.dispatchEvent(new Event("plugin-workspace-changed"));
    void pluginHost.requestRuntime("context", { workspace: workspacePath ?? null, sessionId, theme: theme.mode, locale: "zh-CN", appearance }).catch(() => {});
  }, [workspacePath, sessionId, theme.mode, appearance]);
  useEffect(() => {
    let live = true;
    const local = (event: Event) => setNotice(String((event as CustomEvent).detail));
    window.addEventListener("plugin-local-notice", local);
    const stop = listen<{ pluginId: string; args: unknown[] }>("plugin-notice", ({ payload }) => {
      if (live) setNotice(`${payload.pluginId}：${String(payload.args?.[0] ?? "")}`);
    }).catch(() => () => {});
    return () => { live = false; window.removeEventListener("plugin-local-notice", local); void stop.then((unlisten) => unlisten()); };
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 8000); return () => clearTimeout(timer); }, [notice]);
  return <><PluginThemeController /><PluginLauncher />{notice ? <aside className="plugin-toast" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="关闭插件提示">×</button></aside> : null}</>;
}
