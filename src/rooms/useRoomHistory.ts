import { useEffect, useMemo, useSyncExternalStore } from "react";
import { RoomHistoryPager } from "./history";

export function useRoomHistory(roomId: string) {
  const pager = useMemo(() => new RoomHistoryPager(roomId), [roomId]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot, pager.getSnapshot);
  useEffect(() => () => pager.cancel(), [pager]);
  return { pager, ...state };
}
