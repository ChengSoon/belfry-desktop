import { useEffect, useRef, useState } from "react";
import { listSessions } from "../../collab/api";
import { useWorkspaceEnvironment } from "../../workspace/useWorkspaceEnvironment";
import type { RoomTabView } from "../contracts";
import { RoomView } from "../view/RoomView";
import { toRoomTabViews } from "./roster";

/** 名册轮询间隔：和房间视图同一档，只为画在场状态。 */
const ROSTER_POLL_MS = 2_500;

/**
 * 房间独立窗口（`?room=<id>` 启动）。
 *
 * 只挂房间视图：没有工作台、投递队列、提醒轮询与备份事务——那些属于主窗口，
 * 重复启动会变成两份各说各话的现场。派活、验证、退回这些写操作走全局命令，
 * 投递仍由主窗口的后台队列执行；加成员要新建会话，得落进主窗口的会话清单
 * 才算数，那一步也留给主窗口。
 */
export function RoomWindowApp({ roomId }: { roomId: string }) {
  const environment = useWorkspaceEnvironment(useRef(0));
  useEffect(() => {
    void environment.startAgentDetection();
  }, [environment.startAgentDetection]);
  const tabs = useCollabRosterTabs();
  const close = () => {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().close())
      .catch(() => window.close());
  };
  return (
    <div className="room-window">
      <RoomView agents={environment.agents} initialRoomId={roomId} onClose={close}
        project={null} projectFromRoom tabs={tabs} />
    </div>
  );
}

/** 在场状态从协作名册还原：名册是派活闸门读的同一份真相，这里只读。 */
function useCollabRosterTabs(): RoomTabView[] {
  const [tabs, setTabs] = useState<RoomTabView[]>([]);
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const sessions = await listSessions();
        if (!stopped) setTabs(toRoomTabViews(sessions));
      } catch {
        // 读不到就先维持上一份：画成全员在线或全员离线都会说谎，下一轮会自愈。
      }
    };
    void tick();
    const timer = window.setInterval(tick, ROSTER_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);
  return tabs;
}
