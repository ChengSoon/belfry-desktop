import { t, useTranslation } from "../i18n";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import "../terminal/terminal.css";
import type {
  SessionActivity,
  TerminalCommandTarget,
  TerminalLaunch,
  TerminalPhase,
} from "../terminal/contracts";
import { useTerminalSession } from "../terminal/useTerminalSession";
import type { TerminalSearchState } from "../terminal/search";
import { ICON } from "../theme/sizing";
import type { HookSnapshot } from "../agent/hooks/contracts";
import type { AgentSessionRef } from "../agent/contracts";
import { composingKey } from "../utils/keyboard";

export interface TerminalSnapshot {
  daemonSessionId?: string | null;
  phase: TerminalPhase;
  error: string | null;
  lastInput: string | null;
  activity: SessionActivity;
  agentState?: HookSnapshot | null;
  agentSessionRef?: AgentSessionRef | null;
}

interface TerminalViewportProps {
  /** 会话是否落在某个窗格里。不可见的会话照旧挂着，PTY 不能断。 */
  visible: boolean;
  focused: boolean;
  launch: TerminalLaunch;
  onSnapshot: (snapshot: TerminalSnapshot) => void;
  onCommandTarget?: (target: TerminalCommandTarget | null) => void;
  onOpenFile?: (path: string, line: number | null) => void;
  onOutput?: (text: string) => void;
}

export function TerminalViewport({
  visible,
  focused,
  launch,
  onSnapshot,
  onCommandTarget,
  onOpenFile,
  onOutput,
}: TerminalViewportProps) {
  useTranslation();
  const terminalHost = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<TerminalSearchState>({
    query: "",
    matches: [],
    activeIndex: -1,
  });
  // 挂载条件由 hook 逐项判断；这里不缓存 launch，以免阻断实时历史身份更新。
  const requestSearch = useCallback(() => setSearchOpen(true), []);
  const session = useTerminalSession(terminalHost, launch, requestSearch, onOpenFile, onOutput);
  const dormant = session.phase === "exited" || session.phase === "error";

  useEffect(() => {
    // 多窗格恢复按保存的焦点接收输入，不由 PTY 连接完成顺序决定。
    if (focused && visible && !searchOpen) session.commandTarget.focus();
  }, [focused, visible, searchOpen, session.commandTarget, session.search]);

  useEffect(() => {
    onCommandTarget?.(session.commandTarget);
    return () => onCommandTarget?.(null);
  }, [onCommandTarget, session.commandTarget]);

  useEffect(() => {
    if (!session.search) return;
    setSearchState(session.search.state);
    if (searchOpen) {
      searchInput.current?.focus();
      searchInput.current?.select();
    }
  }, [searchOpen, session.search]);

  const closeSearch = useCallback(() => {
    const controller = session.search;
    setSearchOpen(false);
    setQuery("");
    setSearchState(controller?.clear() ?? {
      query: "",
      matches: [],
      activeIndex: -1,
    });
    controller?.focus();
  }, [session.search]);

  const updateSearch = (value: string) => {
    setQuery(value);
    setSearchState(session.search?.search(value) ?? {
      query: value,
      matches: [],
      activeIndex: -1,
    });
  };

  const moveSearch = (direction: "next" | "previous") => {
    const next = direction === "next"
      ? session.search?.findNext()
      : session.search?.findPrevious();
    if (next) setSearchState(next);
  };

  useEffect(() => {
    onSnapshot({
      phase: session.phase,
      error: session.error,
      lastInput: session.lastInput,
      activity: session.activity,
      agentState: session.agentState,
      agentSessionRef: session.agentSessionRef,
      daemonSessionId: session.daemonSessionId,
    });
  }, [onSnapshot, session.activity, session.agentState, session.agentSessionRef, session.error, session.lastInput, session.phase, session.daemonSessionId]);

  return (
    <section className="terminal-workspace" aria-hidden={!visible}>
      <div className="terminal-canvas" ref={terminalHost} />
      {searchOpen ? (
        <div className="terminal-search" role="search" onPointerDown={(event) => event.stopPropagation()}>
          <Search aria-hidden="true" className="terminal-search__icon" size={ICON.sm} />
          <input
            aria-label={t("components.TerminalViewport.text_0bd6dd7811")}
            autoFocus
            onChange={(event) => updateSearch(event.target.value)}
            onKeyDown={(event) => {
              // 输入法组字时的 Enter 是确认候选词。不放过的话，搜中文时刚打出的拼音
              // 就被当成「跳下一个匹配」，组字也被打断。
              if (composingKey(event.nativeEvent)) return;
              if (event.key === "Enter") {
                event.preventDefault();
                moveSearch(event.shiftKey ? "previous" : "next");
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
            placeholder={t("components.TerminalViewport.text_44ce7ae909")}
            ref={searchInput}
            value={query}
          />
          <span aria-live="polite" className="terminal-search__count">
            {query && searchState.matches.length > 0
              ? `${searchState.activeIndex + 1}/${searchState.matches.length}`
              : query
                ? t("components.TerminalViewport.text_f1c9cc430f")
                : ""}
          </span>
          <button
            aria-label={t("components.TerminalViewport.text_64d57ad378")}
            disabled={searchState.matches.length === 0}
            onClick={() => moveSearch("previous")}
            title={t("components.TerminalViewport.text_64d57ad378")}
            type="button"
          >
            <ArrowUp aria-hidden="true" size={ICON.sm} />
          </button>
          <button
            aria-label={t("components.TerminalViewport.text_84cb6a31b9")}
            disabled={searchState.matches.length === 0}
            onClick={() => moveSearch("next")}
            title={t("components.TerminalViewport.text_84cb6a31b9")}
            type="button"
          >
            <ArrowDown aria-hidden="true" size={ICON.sm} />
          </button>
          <button aria-label={t("components.TerminalViewport.text_ab008ef18d")} onClick={closeSearch} title={t("components.TerminalViewport.text_ab008ef18d")} type="button">
            <X aria-hidden="true" size={ICON.sm} />
          </button>
        </div>
      ) : null}
      {dormant || session.error ? (
        <div className="terminal-alert" role="status">
          <span>{session.error ?? t("components.TerminalViewport.text_8f6969d1d9")}</span>
          {session.canReconnect ? <button onClick={session.reconnect} type="button">{t("components.TerminalViewport.text_68891ab35c")}</button> : null}
          {dormant ? <button onClick={session.restart} type="button">{t("components.TerminalViewport.text_5628228928")}</button>
            : <button onClick={session.dismissError} type="button">{t("components.TerminalViewport.text_d301bc1258")}</button>}
        </div>
      ) : null}
    </section>
  );
}
