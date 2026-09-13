import { useCallback, useEffect, useState } from "react";
import { PROJECT_CATALOG_EVENT, PROJECT_CATALOG_KEY, type ProjectProfile } from "./contracts";
import { updateProfile } from "./model";
import { loadProjectCatalog, saveProjectCatalog } from "./storage";

export function useProjectCatalog() {
  const [state, setState] = useState(loadProjectCatalog);
  const reload = useCallback(() => setState(loadProjectCatalog()), []);
  useEffect(() => {
    const storage = (event: StorageEvent) => { if (!event.key || event.key === PROJECT_CATALOG_KEY) reload(); };
    window.addEventListener(PROJECT_CATALOG_EVENT, reload);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(PROJECT_CATALOG_EVENT, reload); window.removeEventListener("storage", storage); };
  }, [reload]);
  const save = useCallback((profile: ProjectProfile) => {
    if (state.error) throw new Error(`请先处理项目存档错误：${state.error}`);
    const catalog = updateProfile(state.catalog, profile);
    const raw = saveProjectCatalog(catalog, { expectedRaw: state.raw });
    setState({ catalog, raw, error: null });
    return catalog.entries.find((entry) => entry.id === profile.id)!;
  }, [state]);
  return { ...state, save, reload };
}
