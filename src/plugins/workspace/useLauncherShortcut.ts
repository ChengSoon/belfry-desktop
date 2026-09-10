import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { pluginHost } from "../useDirectoryRegistry";
import { LAUNCHER_EVENT } from "./events";

export function useLauncherShortcut() {
  const [open, setOpen] = useState(false), [note, setNote] = useState("");
  useEffect(() => {
    let live = true, global = false, last = 0;
    const toggle = () => {
      const now = Date.now(); if (now - last < 150) return;
      last = now; setOpen((value) => !value);
    };
    const press = (event: KeyboardEvent) => {
      if (global || event.code !== "Space" || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.repeat) return;
      event.preventDefault(); event.stopPropagation(); toggle();
    };
    const stop = listen("plugin-launcher-toggle", () => { if (live) toggle(); }).catch(() => () => {});
    void pluginHost.requestRuntime<{ registered: boolean; error?: string }>("launcher.status").then((status) => {
      if (!live) return;
      global = status.registered;
      setNote(status.registered ? "可在其他应用中使用 Alt + Space 唤起" : "全局快捷键暂不可用，Alt + Space 可在 Belfry 内使用");
    }).catch(() => {});
    window.addEventListener(LAUNCHER_EVENT, toggle); window.addEventListener("keydown", press, true);
    return () => {
      live = false; window.removeEventListener(LAUNCHER_EVENT, toggle); window.removeEventListener("keydown", press, true);
      void stop.then((unlisten) => unlisten());
    };
  }, []);
  return { open, note, close: () => setOpen(false) };
}
