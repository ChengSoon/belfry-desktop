import { useCallback, useEffect, useRef } from "react";
import { NAMED_WORKSPACES_KEY, type WorkspaceSeed } from "./contracts";
import { loadNamedWorkspaces, message, replaceNamedArchive, saveNamedWorkspaces } from "./storage";
import type { CollectionPort } from "./useCollectionState";

export function useCollectionPersistence(port: CollectionPort, seed: WorkspaceSeed) {
  const { ref, commit, snapshot } = port;
  const seedRef = useRef(seed);
  seedRef.current = seed;
  useEffect(() => {
    if (snapshot.error) return;
    try {
      const raw = saveNamedWorkspaces(snapshot.collection, { expectedRaw: ref.current.raw });
      if (raw !== ref.current.raw) commit({ ...ref.current, raw });
    } catch (error) { commit({ ...ref.current, error: message(error) }); }
  }, [commit, ref, snapshot.collection, snapshot.error]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== NAMED_WORKSPACES_KEY || event.newValue === ref.current.raw) return;
      commit({ ...ref.current, error: "工作区已在其他窗口修改，请先重新读取存档" });
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [commit, ref]);
  const retrySave = useCallback(() => {
    try {
      const raw = replaceNamedArchive(ref.current.collection, { expectedRaw: ref.current.raw });
      commit({ ...ref.current, raw, error: null });
    } catch (error) { commit({ ...ref.current, error: message(error) }); }
  }, [commit, ref]);
  const reload = useCallback(() => {
    const next = loadNamedWorkspaces(seedRef.current);
    commit(next.error ? { ...ref.current, error: next.error, raw: next.raw } : next);
  }, [commit, ref]);
  return { retrySave, reload };
}
