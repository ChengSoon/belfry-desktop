import { useFeedback, TranslationError, useTranslation } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { toAppFailure } from "../workspace/errors";
import * as api from "./api";
import type { Room, RoomSummary } from "./contracts";
import { forgetRoomDraft } from "./drafts";

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
  const retainedMessages = same(previous.retainedMessages, next.retainedMessages) ? previous.retainedMessages : next.retainedMessages;
  const deliveryOutbox = same(previous.deliveryOutbox, next.deliveryOutbox) ? previous.deliveryOutbox : next.deliveryOutbox;
  const rest = (room: Room) => ({ ...room, messages: undefined, members: undefined, tasks: undefined, brief: undefined, retainedMessages: undefined, deliveryOutbox: undefined });
  if (!changed && members === previous.members && tasks === previous.tasks && brief === previous.brief
    && retainedMessages === previous.retainedMessages && deliveryOutbox === previous.deliveryOutbox && same(rest(previous), rest(next))) {
    return previous;
  }
  return { ...next, messages: changed ? messages : previous.messages, members, tasks, brief, retainedMessages, deliveryOutbox };
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
  useTranslation();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loadError, setLoadError] = useFeedback<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useFeedback<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef(selectedId);
  const mounted = useRef(false);
  const generation = useRef(0);
  const reads = useRef(0);
  const mutations = useRef(0);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    let selection = selectedRef.current;
    const currentRequest = () => mounted.current && request === generation.current && selection === selectedRef.current;
    reads.current++;
    try {
      const view = await api.roomList();
      if (!currentRequest()) return;
      setRooms((current) => (JSON.stringify(current) === JSON.stringify(view.rooms) ? current : view.rooms));
      setLoadError(view.loadError);
      if (!selection || !view.rooms.some((summary) => summary.id === selection)) {
        selection = view.rooms[0]?.id ?? null;
        setSelectedId(selection);
        selectedRef.current = selection;
        setRoom(null);
      }
      const next = selection ? await api.roomGet(selection) : null;
      if (!currentRequest()) return;
      if (next && next.id !== selection) throw new TranslationError("rooms.useRooms.text_8e2155449e");
      setRoom((previous) => (next ? shareRoom(previous, next) : null));
    } catch (cause) {
      if (currentRequest()) setError(() => toAppFailure(cause).message);
    } finally {
      reads.current--;
    }
  }, []);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    mounted.current = true;
    void refreshRef.current();
    const timer = window.setInterval(() => {
      // Explicit selection/operation refreshes may supersede a slow read; polls never overlap them.
      if (reads.current === 0 && mutations.current === 0) void refreshRef.current();
    }, POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      generation.current++;
      window.clearInterval(timer);
    };
  }, []);

  const select = useCallback((id: string | null) => {
    if (!mounted.current) return;
    generation.current++;
    setSelectedId(id);
    selectedRef.current = id;
    setRoom(null);
    void refreshRef.current();
  }, []);

  const run = useCallback(async (action: () => Promise<Room>) => {
    if (!mounted.current) return null;
    const selection = selectedRef.current;
    mutations.current++;
    generation.current++;
    setBusy(true);
    try {
      const next = await action();
      if (!mounted.current) return next;
      // Reads started both before and during the mutation contain an older snapshot.
      generation.current++;
      if (next.id === selectedRef.current) setRoom((previous) => shareRoom(previous, next));
      if (selection === selectedRef.current) setError(null);
      void refreshRef.current();
      return next;
    } catch (cause) {
      if (mounted.current && selection === selectedRef.current) setError(() => toAppFailure(cause).message);
      return null;
    } finally {
      mutations.current--;
      if (mounted.current) setBusy(mutations.current > 0);
    }
  }, []);

  const create = useCallback(async (name: string, projectRoot: string, objective: string) => {
    const created = await run(() => api.roomCreate(name, projectRoot, objective));
    if (created) select(created.id);
    return created;
  }, [run, select]);

  const remove = useCallback(async (id: string) => {
    if (!mounted.current) return false;
    mutations.current++;
    generation.current++;
    setBusy(true);
    try {
      await api.roomDelete(id);
      forgetRoomDraft(id);
      if (!mounted.current) return true;
      generation.current++;
      if (selectedRef.current === id) select(null);
      else void refreshRef.current();
      return true;
    } catch (cause) {
      if (mounted.current) setError(() => toAppFailure(cause).message);
      return false;
    } finally {
      mutations.current--;
      if (mounted.current) setBusy(mutations.current > 0);
    }
  }, [select]);

  return { rooms, loadError, room, selectedId, error, busy, select, dismissError: () => setError(null), refresh, run, create, remove };
}
