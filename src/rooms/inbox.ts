import { useEffect, useState } from "react";
import type { RoomMessage, RoomSummary } from "./contracts";

/**
 * 「发给你的消息」的已读位：每间房记一个时刻，之后到的发给你的消息算未读。
 *
 * 只认发给你的消息：成员之间的讨论不算你的未读，否则未读点永远亮着、就没人看了。
 * 存在 localStorage，主窗口里各处（侧栏计数、房间列表、对话里的分隔线）共用一份。
 */

const PREFIX = "belfry.rooms.v2.seen.";
const EVENT = "belfry-room-seen";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function store(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function readSeen(roomId: string, storage: Storage | null = store()): number {
  try {
    const value = Number(storage?.getItem(PREFIX + roomId) ?? 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** 推进已读位（只往后推，不往回退）。 */
export function markSeen(roomId: string, at: number, storage: Storage | null = store()) {
  if (at <= readSeen(roomId, storage)) return;
  try { storage?.setItem(PREFIX + roomId, String(at)); } catch { /* 记不住就下次再提醒一遍。 */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: roomId }));
}

export function isUnread(summary: Pick<RoomSummary, "id" | "lastToUser">, storage: Storage | null = store()) {
  return summary.lastToUser !== null && summary.lastToUser.at > readSeen(summary.id, storage);
}

/** 这条消息是不是别人发给你的。 */
export function toUser(message: Pick<RoomMessage, "kind" | "by" | "to">) {
  return message.kind === "chat" && message.by !== "user" && message.to.includes("user");
}

/** 第一条未读的、发给你的消息的下标；没有为 -1。 */
export function firstUnread(messages: readonly RoomMessage[], seen: number) {
  return messages.findIndex((message) => toUser(message) && message.at > seen);
}

/** 最新一条发给你的消息的时刻；没有为 0。 */
export function latestToUser(messages: readonly RoomMessage[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (toUser(messages[index])) return messages[index].at;
  }
  return 0;
}

/** 已读位变了就重新渲染（同一窗口的其他地方推进了已读位、或别的窗口改了 localStorage）。 */
export function useSeenVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    window.addEventListener(EVENT, bump);
    window.addEventListener("storage", bump);
    return () => { window.removeEventListener(EVENT, bump); window.removeEventListener("storage", bump); };
  }, []);
  return version;
}
