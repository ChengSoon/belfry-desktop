import { useCallback, useRef, useState, type RefObject } from "react";
import type { CollectionLoad, WorkspaceSeed } from "./contracts";
import { reconcileCollection } from "./model";
import { loadNamedWorkspaces } from "./storage";

export interface CollectionPort {
  snapshot: CollectionLoad;
  ref: RefObject<CollectionLoad>;
  commit: (next: CollectionLoad) => void;
}

export function useCollectionState(seed: WorkspaceSeed): CollectionPort {
  const [loaded, setLoaded] = useState(() => loadNamedWorkspaces(seed));
  const collection = reconcileCollection(loaded.collection, seed.tabIds).collection;
  const snapshot = collection === loaded.collection ? loaded : { ...loaded, collection };
  // 在同一组件渲染中同步列表，避免 effect 先渲染旧空间再把焦点改回来。
  if (snapshot !== loaded) setLoaded(snapshot);
  const ref = useRef(snapshot);
  ref.current = snapshot;
  const commit = useCallback((next: CollectionLoad) => {
    ref.current = next;
    setLoaded(next);
  }, []);
  return { snapshot, ref, commit };
}
