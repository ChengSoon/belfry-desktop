import { useCallback, useEffect, useRef, useState } from "react";
import { roomList } from "./api";

/** 轮询间隔：和协作面板同一档，只驱动展示面的隔离。 */
const POLL_INTERVAL_MS = 3_000;

/**
 * 房间成员会话的隔离名单：这些会话只在房间里露面，不进侧栏、Quick Open 与 ⌘1-9。
 *
 * 只影响展示层：会话照常运行、接收投递、进协作名册；移出房间或删掉房间之后
 * 它们自然回到普通会话列表。
 */
export function useRoomBoundTabs(): { boundIds: ReadonlySet<string>; refresh: () => Promise<void> } {
  const [boundIds, setBoundIds] = useState<ReadonlySet<string>>(() => new Set());
  const refresh = useCallback(async () => {
    try {
      const view = await roomList();
      setBoundIds(new Set(view.rooms.flatMap((room) => room.memberTabIds)));
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
  return { boundIds, refresh };
}
