import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export interface TerminalSnapshot {
  phase: TerminalPhase;
  error: string | null;
  lastInput: string | null;
  activity: SessionActivity;
}

interface TerminalViewportProps {
  /** 会话是否落在某个窗格里。不可见的会话照旧挂着，PTY 不能断。 */
  visible: boolean;
  launch: TerminalLaunch;
  onSnapshot: (snapshot: TerminalSnapshot) => void;
  onCommandTarget?: (target: TerminalCommandTarget | null) => void;
  onOpenFile?: (path: string, line: number | null) => void;
}

export function TerminalViewport({
  visible,
  launch,
  onSnapshot,
  onCommandTarget,
  onOpenFile,
}: TerminalViewportProps) {
  const terminalHost = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<TerminalSearchState>({
    query: "",
    matches: [],
    activeIndex: -1,
  });
  // resumeSessionId 与 cwd/profileId 一样会触发 PTY 重启，必须一起参与记忆。
  const stableLaunch = useMemo(
    () => launch,
    [launch.cwd, launch.profileId, launch.resumeSessionId, launch.ssh],
  );
  const requestSearch = useCallback(() => setSearchOpen(true), []);
  const session = useTerminalSession(terminalHost, stableLaunch, requestSearch, onOpenFile);
  const dormant = session.phase === "exited" || session.phase === "error";

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
    });
  }, [onSnapshot, session.activity, session.error, session.lastInput, session.phase]);

  return (
    <section className="terminal-workspace" aria-hidden={!visible}>
      <div className="terminal-canvas" ref={terminalHost} />
      {searchOpen ? (
        <div className="terminal-search" role="search" onPointerDown={(event) => event.stopPropagation()}>
          <Search aria-hidden="true" className="terminal-search__icon" size={ICON.sm} />
          <input
            aria-label="搜索终端"
            autoFocus
            onChange={(event) => updateSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                moveSearch(event.shiftKey ? "previous" : "next");
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
            placeholder="搜索"
            ref={searchInput}
            value={query}
          />
          <span aria-live="polite" className="terminal-search__count">
            {query && searchState.matches.length > 0
              ? `${searchState.activeIndex + 1}/${searchState.matches.length}`
              : query
                ? "无结果"
                : ""}
          </span>
          <button
            aria-label="上一个匹配"
            disabled={searchState.matches.length === 0}
            onClick={() => moveSearch("previous")}
            title="上一个匹配"
            type="button"
          >
            <ArrowUp aria-hidden="true" size={ICON.sm} />
          </button>
          <button
            aria-label="下一个匹配"
            disabled={searchState.matches.length === 0}
            onClick={() => moveSearch("next")}
            title="下一个匹配"
            type="button"
          >
            <ArrowDown aria-hidden="true" size={ICON.sm} />
          </button>
          <button aria-label="关闭搜索" onClick={closeSearch} title="关闭搜索" type="button">
            <X aria-hidden="true" size={ICON.sm} />
          </button>
        </div>
      ) : null}
      {dormant ? (
        <div className="terminal-alert" role="status">
          <span>{session.error ?? "进程已退出"}</span>
          <button onClick={session.restart} type="button">重启</button>
        </div>
      ) : null}
    </section>
  );
}
