import { t, useTranslation } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { roomList } from "./api";
import type { RoomSummary } from "./contracts";

/** 轮询间隔：只驱动展示层的隔离与通知文案，不需要很快。 */
const POLL_INTERVAL_MS = 3_000;

export interface RoomBoundTabs {
  boundIds: ReadonlySet<string>;
  /** 最近一次拉到的房间摘要：未读提醒、侧栏计数都从这里算。 */
  summaries: readonly RoomSummary[];
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
  useTranslation();
  const [state, setState] = useState<{ boundIds: ReadonlySet<string>; labels: ReadonlyMap<string, string> }>(
    () => ({ boundIds: new Set(), labels: new Map() }),
  );
  const [summaries, setSummaries] = useState<readonly RoomSummary[]>([]);
  const refresh = useCallback(async () => {
    try {
      const view = await roomList();
      const labels = new Map<string, string>();
      for (const room of view.rooms) {
        room.memberTabIds.forEach((tabId, at) => labels.set(tabId, `${room.name} · ${room.memberTitles[at] ?? t("rooms.useRoomBoundTabs.text_6e6d6ddbb7")}`));
      }
      setState((current) => sameLabels(current.labels, labels) ? current : { boundIds: new Set(labels.keys()), labels });
      setSummaries((current) => sameSummaries(current, view.rooms) ? current : view.rooms);
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
  return { ...state, summaries, refresh };
}

/** 只比较提醒要用的字段，免得每次轮询都换一个新数组、带着侧栏重渲染。 */
function sameSummaries(a: readonly RoomSummary[], b: readonly RoomSummary[]) {
  return a.length === b.length && a.every((room, at) => room.id === b[at].id && room.name === b[at].name
    && room.lastToUser?.id === b[at].lastToUser?.id);
}

function sameLabels(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}
