import { useCallback, useEffect, useRef, useState } from "react";
import { toAppFailure } from "../workspace/errors";
import type { Room, RoomSummary } from "./contracts";
import {
  roomAddMember, roomBroadcast, roomClearMessages, roomCreate, roomDelete, roomDispatch, roomGet,
  roomList, roomMarkDecision, roomReact, roomRejectTask, roomRemoveMember, roomRename, roomRetryTask,
  roomRecall, roomSendMessage, roomStopTask, roomVerifyTask,
} from "./api";

/** 轮询间隔。和协作面板同一档：只驱动显示；真正的确认、验证都由用户触发。 */
const POLL_INTERVAL_MS = 1_500;

/** 记住最后看的那间房：出去看一眼成员的终端再回来，不该跳去别的房间。 */
const SELECTED_KEY = "belfry.rooms.v1.selected";

export interface RoomsController {
  rooms: readonly RoomSummary[];
  /** 存储读不出来时的原因（版本不认识 / 文件损坏）；界面如实展示。 */
  loadError: string | null;
  room: Room | null;
  /** 最近一次动作失败的原因；成功后清空。轮询成功不清——错误一闪而过多半等于没报。 */
  error: string | null;
  /** 打开新弹窗时先清掉上一次的错误，避免旧理由挂在新场景上。 */
  clearError: () => void;
  /** 把与房间数据无关的失败（比如开独立窗口）摆进同一条错误栏。 */
  reportError: (message: string) => void;
  select: (id: string | null) => void;
  refresh: () => Promise<void>;
  createRoom: (name: string, projectRoot: string) => Promise<Room | null>;
  renameRoom: (name: string) => Promise<boolean>;
  deleteRoom: () => Promise<boolean>;
  addMember: (tabId: string, agent: string, role: string, duty: string, projectRoot?: string) => Promise<boolean>;
  removeMember: (memberId: string) => Promise<boolean>;
  sendMessage: (text: string, replyTo?: string | null) => Promise<boolean>;
  /** 撤回自己刚发的一条消息：时间线标记已撤回；还没送出的投递当场撤掉。 */
  recall: (messageId: string) => Promise<boolean>;
  /** 清空聊天记录：时间线归空；任务、决定与投递记录保留，成员终端不受影响。 */
  clearChat: () => Promise<boolean>;
  /** 给某条消息点表情（同一人同一表情再点一次取消）。 */
  react: (messageId: string, emoji: string) => Promise<boolean>;
  markDecision: (messageId: string) => Promise<boolean>;
  dispatch: (text: string, memberIds: string[], acceptance?: string[]) => Promise<boolean>;
  /** 群聊发送：@ 某人只发给 TA，不 @ 发给全体；忙的成员排队而不是被拒。 */
  broadcast: (text: string, replyTo?: string | null) => Promise<boolean>;
  stopTask: (taskId: string) => Promise<boolean>;
  verifyTask: (taskId: string, note?: string) => Promise<boolean>;
  /** 验证不通过：旧任务退回，带反馈的跟进派活立刻发出。 */
  rejectTask: (taskId: string, feedback: string) => Promise<boolean>;
  /** 单成员重派：只把这一条没结果的投递补投回去，不动其他人。 */
  retryDelivery: (taskId: string, memberId: string) => Promise<boolean>;
  retryTask: (taskId: string) => Promise<boolean>;
}

/**
 * 房间的列表 + 当前房间视图。
 *
 * 状态真相在 Rust：动作直接拿回对账后的整间房，不做乐观更新——房间里的
 * 每一条状态（投递、交差、验证）都应该只有一个来源，前端猜出来的乐观
 * 状态迟早和「已送达 · 完成情况未知」的诚实口径打架。
 *
 * 定时器不进 effect 依赖：刷新会改 state，挂上去就变成每次刷新重建定时器。
 */
export function useRooms(): RoomsController {
  const [rooms, setRooms] = useState<readonly RoomSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_KEY);
    } catch {
      return null;
    }
  });
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const roomIdRef = useRef<string | null>(null);
  roomIdRef.current = roomId;

  const refresh = useCallback(async () => {
    try {
      const view = await roomList();
      setLoadError(view.loadError);
      setRooms(view.rooms);
      const current = roomIdRef.current;
      // 首次拿到列表自动选一间，别让人对着空白视图找入口。
      if (!current && view.rooms.length > 0) {
        setRoomId(view.rooms[0].id);
      } else if (current && !view.rooms.some((item) => item.id === current)) {
        setRoomId(null);
        setRoom(null);
        setError(null);
      }
    } catch (cause) {
      setError(toAppFailure(cause).message);
    }
  }, []);

  const fetchRoom = useCallback(async () => {
    const id = roomIdRef.current;
    if (!id) {
      setRoom(null);
      return;
    }
    try {
      const fresh = await roomGet(id);
      // 房间里泡着的时候别被一次切换的回包盖掉。
      if (roomIdRef.current === id) setRoom(fresh);
    } catch (cause) {
      if (roomIdRef.current === id) setError(toAppFailure(cause).message);
    }
  }, []);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const fetchRoomRef = useRef(fetchRoom);
  fetchRoomRef.current = fetchRoom;

  useEffect(() => {
    void refreshRef.current();
    void fetchRoomRef.current();
    const timer = window.setInterval(() => {
      void refreshRef.current();
      void fetchRoomRef.current();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setRoom(null);
    void fetchRoomRef.current();
  }, [roomId]);

  useEffect(() => {
    try {
      if (roomId) localStorage.setItem(SELECTED_KEY, roomId);
      else localStorage.removeItem(SELECTED_KEY);
    } catch {
      // 记不住只是回到自动选第一间，不影响使用。
    }
  }, [roomId]);

  const select = useCallback((id: string | null) => {
    setRoomId(id);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /** 动作共用的包装：成功刷新列表并清错误，失败把原因原样留在面板上。 */
  const run = useCallback(async (action: () => Promise<Room | null>): Promise<boolean> => {
    try {
      const updated = await action();
      if (updated) setRoom(updated);
      setError(null);
      await refreshRef.current();
      return updated !== null;
    } catch (cause) {
      setError(toAppFailure(cause).message);
      return false;
    }
  }, []);

  const withId = useCallback(
    (action: (id: string) => Promise<Room>) => {
      const id = roomIdRef.current;
      if (!id) return Promise.resolve(false);
      return run(() => action(id));
    },
    [run],
  );

  const createRoom = useCallback(async (name: string, projectRoot: string) => {
    try {
      const created = await roomCreate(name, projectRoot);
      setRoomId(created.id);
      setRoom(created);
      setError(null);
      await refreshRef.current();
      return created;
    } catch (cause) {
      setError(toAppFailure(cause).message);
      return null;
    }
  }, []);

  const deleteRoom = useCallback(async () => {
    const id = roomIdRef.current;
    if (!id) return false;
    try {
      await roomDelete(id);
      setRoomId(null);
      setRoom(null);
      setError(null);
      await refreshRef.current();
      return true;
    } catch (cause) {
      setError(toAppFailure(cause).message);
      return false;
    }
  }, []);

  return {
    rooms,
    loadError,
    room,
    error,
    clearError,
    reportError: useCallback((message: string) => setError(message), []),
    select,
    refresh,
    createRoom,
    renameRoom: useCallback((name: string) => withId((id) => roomRename(id, name)), [withId]),
    deleteRoom,
    addMember: useCallback(
      (tabId: string, agent: string, role: string, duty: string, projectRoot?: string) =>
        withId((id) => roomAddMember(id, tabId, agent, role, duty, projectRoot)),
      [withId],
    ),
    removeMember: useCallback((memberId: string) => withId((id) => roomRemoveMember(id, memberId)), [withId]),
    sendMessage: useCallback((text: string, replyTo?: string | null) => withId((id) => roomSendMessage(id, text, replyTo)), [withId]),
    recall: useCallback((messageId: string) => withId((id) => roomRecall(id, messageId)), [withId]),
    clearChat: useCallback(() => withId((id) => roomClearMessages(id)), [withId]),
    react: useCallback((messageId: string, emoji: string) => withId((id) => roomReact(id, messageId, emoji)), [withId]),
    markDecision: useCallback((messageId: string) => withId((id) => roomMarkDecision(id, messageId)), [withId]),
    dispatch: useCallback(
      (text: string, memberIds: string[], acceptance?: string[]) => withId((id) => roomDispatch(id, text, memberIds, acceptance)),
      [withId],
    ),
    broadcast: useCallback((text: string, replyTo?: string | null) => withId((id) => roomBroadcast(id, text, replyTo)), [withId]),
    stopTask: useCallback((taskId: string) => withId((id) => roomStopTask(id, taskId)), [withId]),
    verifyTask: useCallback((taskId: string, note?: string) => withId((id) => roomVerifyTask(id, taskId, note)), [withId]),
    rejectTask: useCallback((taskId: string, feedback: string) => withId((id) => roomRejectTask(id, taskId, feedback)), [withId]),
    retryDelivery: useCallback((taskId: string, memberId: string) => withId((id) => roomRetryTask(id, taskId, [memberId])), [withId]),
    retryTask: useCallback((taskId: string) => withId((id) => roomRetryTask(id, taskId)), [withId]),
  };
}
