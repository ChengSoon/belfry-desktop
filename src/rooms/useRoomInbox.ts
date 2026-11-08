import { getLocale, t, useTranslation } from "../i18n";
import { useEffect, useMemo, useRef } from "react";
import { notify } from "../notify/api";
import type { RoomSummary } from "./contracts";
import { isUnread, isWatchingRoom, readSeen, useSeenVersion } from "./inbox";

/**
 * 发给你的房间消息：系统通知 + 未读计数。
 *
 * 统筹汇报「做完了」、成员找你拍板，都是发给 @用户 的消息。房间关着时你看不到，所以要通知。
 * 只通知新到的：启动时已有的未读不弹（只记进计数），每条只弹一次；你正看着房间时不弹。
 *
 * 返回有未读的房间数，给侧栏「协作房间」按钮计数用。
 */
export function useRoomInbox(summaries: readonly RoomSummary[], watching: boolean): number {
  useTranslation();
  const version = useSeenVersion();
  const notified = useRef<Set<string> | null>(null);
  const watchingRef = useRef(watching);
  watchingRef.current = watching;

  useEffect(() => {
    if (notified.current === null) {
      // 第一次拿到摘要：把已有的都当作通知过，只记未读，不补弹。
      if (!summaries.length) return;
      notified.current = new Set(summaries.flatMap((room) => (room.lastToUser ? [room.lastToUser.id] : [])));
      return;
    }
    for (const room of summaries) {
      const note = room.lastToUser;
      if (!note || notified.current.has(note.id)) continue;
      notified.current.add(note.id);
      if (note.at <= readSeen(room.id)) continue;
      if (watchingRef.current && isWatchingRoom(room.id) && document.visibilityState === "visible" && document.hasFocus()) continue;
      void notify({ title: t("rooms.useRoomInbox.text_d0f2f1dc92", { from: note.from }), body: `${room.name} · ${note.text}` });
    }
  }, [summaries]);

  return useMemo(() => summaries.filter((room) => isUnread(room)).length, [summaries, version, getLocale()]);
}
