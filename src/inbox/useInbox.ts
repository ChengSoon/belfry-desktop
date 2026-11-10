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
export function useInbox(projectRoots: readonly string[], enabled: boolean, ports: InboxReadPorts = defaultPorts): InboxView {
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
  const rootsKey = projectRoots.join("\n");
  const rootsRef = useRef(projectRoots); rootsRef.current = projectRoots;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const portsRef = useRef(ports); portsRef.current = ports;
  const listBusy = useRef(false), msgBusy = useRef(false);

  const readSessions = useCallback(async () => {
    const request = ++listGen.current;
    listBusy.current = true;
    try {
      const views = await Promise.all(rootsRef.current.map((root) => portsRef.current.sessions(root, null)));
      if (!mounted.current || request !== listGen.current) return;
      const failed = views.find((view) => view.loadError);
      setSessions(mergeSessions(views.map((view) => view.sessions)));
      setError(failed?.loadError ? () => failed.loadError : null);
      setLoaded(true);
    } catch (cause) {
      if (mounted.current && request === listGen.current) setError(() => toAppFailure(cause).message);
    } finally { if (request === listGen.current) listBusy.current = false; }
  }, []);

  /** 读最新一页。保留已加载的更早页：按收件项 id 合并，新数据覆盖旧状态。 */
  const readLatest = useCallback(async (reset: boolean) => {
    const key = selectedRef.current;
    const request = ++msgGen.current;
    if (!key) { setMessages([]); setCursor(null); return; }
    msgBusy.current = true;
    try {
      const view = await portsRef.current.messages({ sessionKey: key, limit: PAGE });
      if (!mounted.current || request !== msgGen.current || key !== selectedRef.current) return;
      setMessages((current) => reset ? sortMessages(view.messages) : mergeMessages(current, view.messages));
      if (reset) setCursor(view.nextCursor);
      setMessagesError(view.loadError ? () => view.loadError : null);
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
      const view = await portsRef.current.messages({ sessionKey: key, cursor, limit: PAGE });
      if (!mounted.current || request !== olderGen.current || key !== selectedRef.current) return;
      setMessages((current) => mergeMessages(current, view.messages));
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
    setSelected(key); setMessages([]); setCursor(null); setLoadingOlder(false); setMessagesError(null);
    void readLatest(true);
  }, [readLatest]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return () => { mounted.current = false; };
    void readSessions();
    if (selectedRef.current) void readLatest(true);
    const timer = window.setInterval(() => {
      if (!listBusy.current) void readSessions();
      if (selectedRef.current && !msgBusy.current) void readLatest(false);
    }, POLL_MS);
    return () => { mounted.current = false; listGen.current++; msgGen.current++; olderGen.current++; window.clearInterval(timer); };
  }, [enabled, rootsKey, readSessions, readLatest]);

  const refresh = useCallback(async () => { await Promise.all([readSessions(), readLatest(false)]); }, [readSessions, readLatest]);

  return { sessions, selected, select, messages, hasOlder: !!cursor, loadingOlder, loadOlder, error, messagesError, loaded, refresh };
}

export function sortMessages(list: readonly MessageView[]) {
  return [...list].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
/** 按收件项 id 去重；同一 id 取 revision 较新的那份。 */
export function mergeMessages(current: readonly MessageView[], incoming: readonly MessageView[]) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) {
    const known = byId.get(m.id);
    if (!known || m.revision >= known.revision) byId.set(m.id, m);
  }
  return sortMessages([...byId.values()]);
}
