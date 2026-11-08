import { useCallback, useEffect, useRef, useState } from "react";
import { toAppFailure } from "../workspace/errors";
import * as api from "./api";
import type { Room, RoomSummary } from "./contracts";

/** 轮询间隔：成员在 CLI 里动任务板、发消息，界面要跟得上；和协作面板同一档。 */
const POLL_INTERVAL_MS = 1_500;

/**
 * 轮询拿回的整间房和上一份结构共享：没变的消息、成员、任务沿用旧对象，整间房没变就返回旧的那份。
 *
 * 不这样做的话，每 1.5 秒一份全新的对象，所有消息（含 Markdown）都要重渲染一遍，
 * 翻历史时滚动会卡。按 JSON 比较：一间房最多 1000 条消息，比较只要几毫秒。
 */
export function shareRoom(previous: Room | null, next: Room): Room {
  if (!previous || previous.id !== next.id) return next;
  const same = <T,>(a: T, b: T) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const old = new Map(previous.messages.map((message) => [message.id, message]));
  let changed = previous.messages.length !== next.messages.length;
  const messages = next.messages.map((message, index) => {
    const prior = old.get(message.id);
    if (prior && same(prior, message)) {
      if (previous.messages[index] !== prior) changed = true;
      return prior;
    }
    changed = true;
    return message;
  });
  const members = same(previous.members, next.members) ? previous.members : next.members;
  const tasks = same(previous.tasks, next.tasks) ? previous.tasks : next.tasks;
  const brief = same(previous.brief, next.brief) ? previous.brief : next.brief;
  const rest = (room: Room) => ({ ...room, messages: undefined, members: undefined, tasks: undefined, brief: undefined });
  if (!changed && members === previous.members && tasks === previous.tasks && brief === previous.brief && same(rest(previous), rest(next))) {
    return previous;
  }
  return { ...next, messages: changed ? messages : previous.messages, members, tasks, brief };
}

export interface RoomsState {
  rooms: RoomSummary[];
  loadError: string | null;
  room: Room | null;
  selectedId: string | null;
  error: string | null;
  busy: boolean;
  select: (id: string | null) => void;
  dismissError: () => void;
  refresh: () => Promise<void>;
  /** 跑一个改动：成功时换上返回的整间房，失败时把理由放进 `error`。返回是否成功。 */
  run: (action: () => Promise<Room>) => Promise<Room | null>;
  create: (name: string, projectRoot: string, objective: string) => Promise<Room | null>;
  remove: (id: string) => Promise<boolean>;
}

export function useRooms(): RoomsState {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const refresh = useCallback(async () => {
    try {
      const view = await api.roomList();
      setRooms((current) => (JSON.stringify(current) === JSON.stringify(view.rooms) ? current : view.rooms));
      setLoadError(view.loadError);
      let current = selectedRef.current;
      if (!current || !view.rooms.some((summary) => summary.id === current)) {
        current = view.rooms[0]?.id ?? null;
        setSelectedId(current);
        selectedRef.current = current;
      }
      const next = current ? await api.roomGet(current) : null;
      setRoom((previous) => (next ? shareRoom(previous, next) : null));
    } catch (cause) {
      setError(toAppFailure(cause).message);
    }
  }, []);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    void refreshRef.current();
    const timer = window.setInterval(() => void refreshRef.current(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    selectedRef.current = id;
    setRoom(null);
    void refreshRef.current();
  }, []);

  const run = useCallback(async (action: () => Promise<Room>) => {
    setBusy(true);
    try {
      const next = await action();
      if (next.id === selectedRef.current) setRoom((previous) => shareRoom(previous, next));
      setError(null);
      void refreshRef.current();
      return next;
    } catch (cause) {
      setError(toAppFailure(cause).message);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(async (name: string, projectRoot: string, objective: string) => {
    const created = await run(() => api.roomCreate(name, projectRoot, objective));
    if (created) select(created.id);
    return created;
  }, [run, select]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await api.roomDelete(id);
      if (selectedRef.current === id) select(null);
      else void refreshRef.current();
      return true;
    } catch (cause) {
      setError(toAppFailure(cause).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [select]);

  return { rooms, loadError, room, selectedId, error, busy, select, dismissError: () => setError(null), refresh, run, create, remove };
}
