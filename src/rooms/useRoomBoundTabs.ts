import { useCallback, useEffect, useRef, useState } from "react";
import { roomList } from "./api";

/** 轮询间隔：只驱动展示层的隔离与通知文案，不需要很快。 */
const POLL_INTERVAL_MS = 3_000;

export interface RoomBoundTabs {
  boundIds: ReadonlySet<string>;
  /** 成员会话 → 「房间名 · 角色」：通知里认得出是谁在等你。 */
  labels: ReadonlyMap<string, string>;
  refresh: () => Promise<void>;
}

/**
 * 房间成员会话的隔离名单：这些会话只在房间里露面，不进侧栏、Quick Open 与 ⌘1-9。
 *
 * 只影响展示层：会话照常运行、接收投递、进协作名册；移出房间或删掉房间之后
 * 它们自然回到普通会话列表。
 */
export function useRoomBoundTabs(): RoomBoundTabs {
  const [state, setState] = useState<{ boundIds: ReadonlySet<string>; labels: ReadonlyMap<string, string> }>(
    () => ({ boundIds: new Set(), labels: new Map() }),
  );
  const refresh = useCallback(async () => {
    try {
      const view = await roomList();
      const labels = new Map<string, string>();
      for (const room of view.rooms) {
        room.memberTabIds.forEach((tabId, at) => labels.set(tabId, `${room.name} · ${room.memberTitles[at] ?? "成员"}`));
      }
      setState((current) => sameLabels(current.labels, labels) ? current : { boundIds: new Set(labels.keys()), labels });
    } catch {
      // 读不到就维持上一份：偶尔闪出成员会话，好过把普通会话藏没了。
    }
  }, []);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    void refreshRef.current();
    const timer = window.setInterval(() => void refreshRef.current(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  return { ...state, refresh };
}

function sameLabels(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}
