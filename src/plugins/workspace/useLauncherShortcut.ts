import { t, useTranslation } from "../../i18n";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { pluginHost } from "../useDirectoryRegistry";
import { LAUNCHER_EVENT } from "./events";
import { isShortcutRecording } from "../../shortcuts/custom/recording";
import { composingKey } from "../../utils/keyboard";

export function useLauncherShortcut() {
  useTranslation();
  const [open, setOpen] = useState(false), [note, setNote] = useState("");
  useEffect(() => {
    let live = true, global = false, last = 0;
    const toggle = () => {
      if (isShortcutRecording()) return;
      const now = Date.now(); if (now - last < 150) return;
      last = now; setOpen((value) => !value);
    };
    const press = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isShortcutRecording()) return;
      if (global || event.code !== "Space" || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || composingKey(event) || event.repeat) return;
      event.preventDefault(); event.stopPropagation(); toggle();
    };
    const stop = listen("plugin-launcher-toggle", () => { if (live) toggle(); }).catch(() => () => {});
    void pluginHost.requestRuntime<{ registered: boolean; error?: string }>("launcher.status").then((status) => {
      if (!live) return;
      global = status.registered;
      setNote(status.registered ? t("plugins.useLauncherShortcut.text_c6af35df78") : t("plugins.useLauncherShortcut.text_a3684d6ead"));
    }).catch(() => {});
    window.addEventListener(LAUNCHER_EVENT, toggle); window.addEventListener("keydown", press, true);
    return () => {
      live = false; window.removeEventListener(LAUNCHER_EVENT, toggle); window.removeEventListener("keydown", press, true);
      void stop.then((unlisten) => unlisten());
    };
  }, []);
  return { open, note, close: () => setOpen(false) };
}
