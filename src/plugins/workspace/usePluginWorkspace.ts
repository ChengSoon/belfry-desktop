import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { pluginHost } from "../useDirectoryRegistry";
import { pluginNotice } from "../notices";
import { usePluginRuntime } from "../usePluginRuntime";
import { isMac, shortcutConflict, shortcutMatches } from "../center/shortcuts";
import { DOCK_EVENT, VIEW_EVENT } from "./events";

export function usePluginWorkspace(callbacks: {
  openProject: (path: string) => Promise<void>; reveal: () => void; toggle: () => void;
}) {
  useEffect(() => {
    const project = (event: Event) => {
      const directory = (event as CustomEvent<string>).detail;
      if (typeof directory === "string" && directory) void callbacks.openProject(directory).catch((error) => pluginNotice(String(error)));
    };
    window.addEventListener("plugin-open-project", project);
    window.addEventListener(DOCK_EVENT, callbacks.toggle);
    window.addEventListener(VIEW_EVENT, callbacks.reveal);
    const stop = listen("plugin-view-open", callbacks.reveal).catch(() => () => {});
    return () => {
      window.removeEventListener("plugin-open-project", project);
      window.removeEventListener(DOCK_EVENT, callbacks.toggle);
      window.removeEventListener(VIEW_EVENT, callbacks.reveal);
      void stop.then((unlisten) => unlisten());
    };
  }, [callbacks.openProject, callbacks.reveal, callbacks.toggle]);
}

export function usePluginShortcuts() {
  const runtime = usePluginRuntime();
  useEffect(() => {
    const mac = isMac();
    const press = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || document.querySelector("[data-shortcut-recorder='true']")) return;
      const binding = runtime.shortcuts?.find((item) => shortcutMatches(item.binding, event, mac));
      if (!binding || shortcutConflict([binding.binding], mac)) return;
      event.preventDefault(); event.stopPropagation();
      void pluginHost.runCommand(binding.pluginId, binding.commandId).catch((error) => pluginNotice(String(error)));
    };
    window.addEventListener("keydown", press, true);
    return () => window.removeEventListener("keydown", press, true);
  }, [runtime.shortcuts]);
}
