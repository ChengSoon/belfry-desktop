import type { SessionSnapshot } from "../../collab/contracts";
import type { RoomTabView } from "../contracts";

/**
 * 名册快照 → 房间视图要的会话切片。
 *
 * 与 `memberPresence` 同一套口径：能接活就是空闲；还在动的标忙；闲着却接不了
 * 活的按离线画——名册只收 Agent 会话，这种多半是进程已经退了（名册不推
 * phase，这是能还原的最接近真相的画法）。
 */
export function toRoomTabViews(sessions: readonly SessionSnapshot[]): RoomTabView[] {
  return sessions.map((session) => ({
    id: session.tabId,
    kind: session.agent,
    phase: session.canReceive || session.activity !== "idle" ? "running" : "exited",
    activity: session.activity,
    agentName: session.name,
    title: session.title,
  }));
}
