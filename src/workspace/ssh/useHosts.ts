import { useCallback, useEffect, useState } from "react";
import { SSH_HOSTS_EVENT, SSH_HOSTS_KEY, type HostProfile } from "./contracts";
import { saveHost } from "./model";
import { loadHosts, persistHosts } from "./storage";

export function useHosts() {
  const [state, setState] = useState(loadHosts);
  const reload = useCallback(() => setState(loadHosts()), []);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (!event.key || event.key === SSH_HOSTS_KEY) reload(); };
    window.addEventListener(SSH_HOSTS_EVENT, reload); window.addEventListener("storage", changed);
    return () => { window.removeEventListener(SSH_HOSTS_EVENT, reload); window.removeEventListener("storage", changed); };
  }, [reload]);
  const save = useCallback((entry: HostProfile) => {
    if (state.error) throw new Error(state.error);
    const catalog = saveHost(state.catalog, entry);
    const raw = persistHosts(catalog, { expectedRaw: state.raw });
    setState({ catalog, raw, error: null });
    return catalog.entries.find((item) => item.id === entry.id)!;
  }, [state]);
  return { ...state, save, reload };
}
