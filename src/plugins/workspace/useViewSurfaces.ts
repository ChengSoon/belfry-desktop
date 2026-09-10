import { useEffect, useState } from "react";
import { pluginHost } from "../useDirectoryRegistry";
import { pluginError } from "../hostClient";
import type { RuntimeCatalog, RuntimeView } from "../runtimeContracts";
import { viewKey } from "./events";

export interface ViewSurface { key: string; url: string; title: string; pid: number; revision: number }
const MAX_CACHED_VIEWS = 4;
export function useViewSurfaces(active: RuntimeView | undefined, runtime: RuntimeCatalog) {
  const [cache, setCache] = useState<ViewSurface[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const key = active ? viewKey(active.pluginId, active.id) : "";
  const pid = runtime.plugins.find((plugin) => plugin.id === active?.pluginId)?.pid ?? 0;
  const validKeys = runtime.views.map((view) => viewKey(view.pluginId, view.id)).sort().join("\n");
  useEffect(() => { setCache((values) => values.filter((item) => validKeys.split("\n").includes(item.key))); }, [validKeys]);
  useEffect(() => {
    if (!active || !pid) return;
    let live = true;
    setError("");
    void pluginHost.requestRuntime<{ url: string; title: string }>("surface", { pluginId: active.pluginId, viewId: active.id })
      .then((surface) => {
        if (!live) return;
        setCache((values) => [...values.filter((item) => item.key !== key), { ...surface, key, pid, revision }].slice(-MAX_CACHED_VIEWS));
      }).catch((reason) => { if (live) setError(pluginError(reason)); });
    return () => { live = false; };
  }, [key, pid, revision]);
  return { surfaces: cache, error, key, refresh: () => setRevision((value) => value + 1) };
}
