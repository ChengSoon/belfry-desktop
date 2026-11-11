import { useCallback, useEffect, useRef, useState } from "react";
import { useFeedback } from "../i18n";
import { toAppFailure } from "../workspace/errors";
import { inboxMessages, inboxSessions } from "./api";
import type { MessageView, SessionView } from "./contracts";
import { mergeSessions } from "./status";

const POLL_MS = 1_500;
const PAGE = 50;

export interface InboxReadPorts {
  sessions: typeof inboxSessions;
  messages: typeof inboxMessages;
}
const defaultPorts: InboxReadPorts = { sessions: inboxSessions, messages: inboxMessages };

export interface InboxView {
  sessions: readonly SessionView[];
  selected: string | null;
  select: (sessionKey: string | null) => void;
  messages: readonly MessageView[];
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => Promise<void>;
  error: string | null;
  messagesError: string | null;
  loaded: boolean;
  refresh: () => Promise<void>;
}

/**
 * 只读收件箱数据。两个读接口都无副作用：打开、切换、翻页不会 claim 或触发投递。
 * 每类请求各有代次：切换会话或项目后，迟到的旧响应一律丢弃；读取失败保留上次结果并显示错误。
 */
export function useInbox(projectRoots: readonly string[], enabled: boolean, ports: InboxReadPorts = defaultPorts, roomId: string | null = null): InboxView {
  const [sessions, setSessions] = useState<readonly SessionView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly MessageView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useFeedback<string | null>(null);
  const [messagesError, setMessagesError] = useFeedback<string | null>(null);
  const listGen = useRef(0), msgGen = useRef(0), olderGen = useRef(0);
  const mounted = useRef(true);
  // 房间页签只看本房间的收件；换房间等同换范围，旧选择与旧响应一并作废。
  const rootsKey = `${roomId ?? ""}\u0000${projectRoots.join("\n")}`;
  const roomRef = useRef(roomId); roomRef.current = roomId;
  const rootsRef = useRef(projectRoots); rootsRef.current = projectRoots;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const portsRef = useRef(ports); portsRef.current = ports;
  const listBusy = useRef(false), msgBusy = useRef(false);
  const messagesRef = useRef(messages); messagesRef.current = messages;
  const readRevision = useRef<number | null>(null);
  const sessionRoots = useRef(new Map<string, string[]>());
  const previousRoots = useRef(rootsKey);
  const previousRoom = useRef(roomId);

  const readSessions = useCallback(async () => {
    const request = ++listGen.current;
    listBusy.current = true;
    try {
      const roots = [...rootsRef.current];
      const views = await Promise.all(roots.map((root) => portsRef.current.sessions(root, roomRef.current)));
      if (!mounted.current || request !== listGen.current) return;
      const failed = views.find((view) => view.loadError);
      const origins = new Map<string, string[]>();
      views.forEach((view, index) => view.sessions.forEach((session) => {
        origins.set(session.sessionKey, [...(origins.get(session.sessionKey) ?? []), roots[index]]);
      }));
      sessionRoots.current = origins;
      setSessions(mergeSessions(views.map((view) => view.sessions)));
      setError(failed?.loadError ? () => failed.loadError : null);
      setLoaded(true);
    } catch (cause) {
      if (mounted.current && request === listGen.current) setError(() => toAppFailure(cause).message);
    } finally { if (request === listGen.current) listBusy.current = false; }
  }, []);

  /** 版本变化后重取已展开的时间范围，同时补齐一次到达多页消息时的间隙。 */
  const readLatest = useCallback(async (reset: boolean) => {
    const key = selectedRef.current;
    const request = ++msgGen.current;
    if (!key) { setMessages([]); setCursor(null); return; }
    msgBusy.current = true;
    try {
      const view = await portsRef.current.messages({ sessionKey: key, roomId: roomRef.current, limit: PAGE });
      if (!mounted.current || request !== msgGen.current || key !== selectedRef.current) return;
      const oldest = reset ? undefined : messagesRef.current[0];
      let incoming = sortMessages(view.messages), next = view.nextCursor, revision = view.revision;
      let loadError = view.loadError;
      const seen = new Set<string>();
      if (oldest && view.revision !== readRevision.current && !loadError) {
        while (next && (!incoming.length || compareMessages(incoming[0], oldest) > 0)) {
          if (seen.has(next)) throw new Error("The message history cursor did not advance.");
          seen.add(next);
          const older = await portsRef.current.messages({ sessionKey: key, roomId: roomRef.current, cursor: next, limit: PAGE });
          if (!mounted.current || request !== msgGen.current || key !== selectedRef.current) return;
          incoming = mergeMessages(incoming, older.messages);
          revision = Math.min(revision, older.revision);
          next = older.nextCursor;
          if (older.loadError) { loadError = older.loadError; break; }
        }
        // The existing cursor still addresses the original oldest boundary.
        // Do not silently load extra history just because a refresh crossed a page.
        incoming = incoming.filter((message) => compareMessages(message, oldest) >= 0);
      }
      setMessages((current) => {
        const merged = reset ? incoming : mergeMessages(current, incoming);
        messagesRef.current = merged;
        return merged;
      });
      if (reset || !oldest) setCursor(view.nextCursor);
      if (!loadError) readRevision.current = revision;
      setMessagesError(loadError ? () => loadError : null);
    } catch (cause) {
      if (mounted.current && request === msgGen.current) setMessagesError(() => toAppFailure(cause).message);
    } finally { if (request === msgGen.current) msgBusy.current = false; }
  }, []);

  const loadOlder = useCallback(async () => {
    const key = selectedRef.current;
    if (!key || !cursor || loadingOlder) return;
    const request = ++olderGen.current;
    setLoadingOlder(true);
    try {
      // 游标原样回传，不解析。
      const view = await portsRef.current.messages({ sessionKey: key, roomId: roomRef.current, cursor, limit: PAGE });
      if (!mounted.current || request !== olderGen.current || key !== selectedRef.current) return;
      setMessages((current) => {
        const merged = mergeMessages(current, view.messages);
        messagesRef.current = merged;
        return merged;
      });
      setCursor(view.nextCursor);
      setMessagesError(view.loadError ? () => view.loadError : null);
    } catch (cause) {
      if (mounted.current && request === olderGen.current) setMessagesError(() => toAppFailure(cause).message);
    } finally { if (mounted.current && request === olderGen.current) setLoadingOlder(false); }
  }, [cursor, loadingOlder]);

  const select = useCallback((key: string | null) => {
    if (key === selectedRef.current) return;
    selectedRef.current = key;
    olderGen.current++;
    messagesRef.current = []; readRevision.current = null;
    setSelected(key); setMessages([]); setCursor(null); setLoadingOlder(false); setMessagesError(null);
    void readLatest(true);
  }, [readLatest]);

  useEffect(() => {
    mounted.current = true;
    if (previousRoots.current !== rootsKey) {
      const roomChanged = previousRoom.current !== roomId;
      previousRoots.current = rootsKey; previousRoom.current = roomId;
      const inScope = (key: string) => !roomChanged && sessionRoots.current.get(key)?.some((root) => rootsRef.current.includes(root));
      setSessions((current) => current.filter((session) => inScope(session.sessionKey)));
      if (selectedRef.current && !inScope(selectedRef.current)) select(null);
      setLoaded(false);
    }
    if (!enabled) return () => { mounted.current = false; };
    void readSessions();
    if (selectedRef.current) void readLatest(true);
    const timer = window.setInterval(() => {
      if (!listBusy.current) void readSessions();
      if (selectedRef.current && !msgBusy.current) void readLatest(false);
    }, POLL_MS);
    return () => { mounted.current = false; listGen.current++; msgGen.current++; olderGen.current++; window.clearInterval(timer); };
  }, [enabled, rootsKey, roomId, readSessions, readLatest, select]);

  const refresh = useCallback(async () => { await Promise.all([readSessions(), readLatest(false)]); }, [readSessions, readLatest]);

  return { sessions, selected, select, messages, hasOlder: !!cursor, loadingOlder, loadOlder, error, messagesError, loaded, refresh };
}

export function sortMessages(list: readonly MessageView[]) {
  return [...list].sort(compareMessages);
}
function compareMessages(a: MessageView, b: MessageView) { return a.createdAt - b.createdAt || a.id.localeCompare(b.id); }
/** 按收件项 id 去重；同一 id 取 revision 较新的那份。 */
export function mergeMessages(current: readonly MessageView[], incoming: readonly MessageView[]) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) {
    const known = byId.get(m.id);
    if (!known || m.revision >= known.revision) byId.set(m.id, m);
  }
  return sortMessages([...byId.values()]);
}
