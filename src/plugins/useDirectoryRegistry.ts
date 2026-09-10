import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { PluginHostClient, pluginError } from "./hostClient";
import type { DirectoryRegistry } from "./hostContracts";
export const pluginHost = new PluginHostClient();
export function useDirectoryRegistry() {
  const [registry, setRegistry] = useState<DirectoryRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    try {
      const value = await pluginHost.list();
      if (request === epoch.current) { setRegistry(value); setError(null); }
    } catch (reason) {
      if (request === epoch.current) { setRegistry(null); setError(pluginError(reason)); }
    }
  }, []);
  useEffect(() => {
    let live = true;
    void refresh();
    const unlisten = listen("plugins-changed", () => { if (live) void refresh(); }).catch(() => () => {});
    const timer = window.setInterval(() => { if (live) void refresh(); }, 3000);
    return () => { live = false; ++epoch.current; window.clearInterval(timer); void unlisten.then((stop) => stop()).catch(() => {}); };
  }, [refresh]);
  return { registry, error, refresh };
}
