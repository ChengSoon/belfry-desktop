import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useBackground } from "../background/BackgroundProvider";
import { useTheme } from "../theme/ThemeProvider";
import { xtermTheme } from "../theme/xtermTheme";
import { useTypography } from "../typography/TypographyProvider";
import { closeTerminal, closeTerminalTab } from "./api";
import {
  type SessionActivity,
  type TerminalCommandTarget,
  type TerminalLaunch,
  type TerminalPhase,
  type TerminalSession,
} from "./contracts";
import { errorMessage, mountTerminal, type TerminalHandle } from "./terminalController";
import type { TerminalSearchController } from "./search";
import type { HookSnapshot } from "../agent/hooks/contracts";

interface TerminalViewModel {
  daemonSessionId?: string;
  canReconnect: boolean;
  reconnect: () => void;
  phase: TerminalPhase;
  error: string | null;
  shell: string;
  cols: number;
  rows: number;
  /** 用户最近提交的一行原始输入，未做任何提炼。 */
  lastInput: string | null;
  /** 会话在生成 / 等按键 / 闲着。Shell 会话恒为 idle。 */
  activity: SessionActivity;
  agentState: HookSnapshot | null;
  search: TerminalSearchController | null;
  commandTarget: TerminalCommandTarget;
  restart: () => void;
  close: () => void;
  dismissError: () => void;
}

export function useTerminalSession(
  container: RefObject<HTMLDivElement | null>,
  launch: TerminalLaunch = {
    profileId: "system-default",
    cwd: null,
    tabId: null,
    collaborationMode: false,
    resumeSessionId: null,
    ssh: null,
  },
  onSearchRequest?: () => void,
  onOpenFile?: (path: string, line: number | null) => void,
  onOutput?: (text: string) => void,
): TerminalViewModel {
  const { mode } = useTheme();
  const { runtime: typography } = useTypography();
  // 有图可铺时终端才让底色透出去；图还没加载完就照旧不透明，避免中间闪一下画布色。
  const { url } = useBackground();
  const transparent = url !== null;
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<TerminalPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [lastInput, setLastInput] = useState<string | null>(null);
  const [activity, setActivity] = useState<SessionActivity>("idle");
  const [agentState, setAgentState] = useState<HookSnapshot | null>(null);
  const [search, setSearch] = useState<TerminalSearchController | null>(null);
  const sessionId = useRef<string | null>(null);
  const attachment = useRef(launch.attachmentId ?? null);
  const target = useRef(launch);
  const handle = useRef<TerminalHandle | null>(null);
  // 主题、背景和字体都不能进挂载 effect 的依赖，否则设置外观会重挂终端、连带杀掉 PTY 会话。
  const themeMode = useRef(mode);
  const transparentMode = useRef(transparent);
  const typographyConfig = useRef(typography);
  const searchRequest = useRef(onSearchRequest);
  searchRequest.current = onSearchRequest;
  const fileRequest = useRef(onOpenFile);
  fileRequest.current = onOpenFile;
  const outputRequest = useRef(onOutput);
  outputRequest.current = onOutput;

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let active = true;
    const guard = <T,>(write: (value: T) => void) => (value: T) => { if (active) write(value); };
    if (target.current.cwd !== launch.cwd || target.current.profileId !== launch.profileId || target.current.ssh !== launch.ssh) {
      attachment.current = launch.attachmentId ?? null;
    }
    target.current = launch;
    const mounted = mountTerminal(
      host,
      { ...launch, attachmentId: attachment.current },
      xtermTheme(themeMode.current),
      transparentMode.current,
      typographyConfig.current,
      {
        onPhase: guard(setPhase),
        onError: guard(setError),
        onSession: (value) => {
          if (!active) return;
          if (value) { sessionId.current = value.id; attachment.current = value.id; setSession(value); }
        },
        onInput: guard(setLastInput),
        onActivity: guard(setActivity),
        onAgentState: guard(setAgentState),
        onOpenFile: (path, line) => fileRequest.current?.(path, line),
        onOutput: (text) => outputRequest.current?.(text),
        onSearchRequest: () => searchRequest.current?.(),
      },
    );
    handle.current = mounted;
    setSearch(mounted.search);
    return () => {
      active = false;
      handle.current = null;
      setSearch(null);
      mounted.dispose();
    };
  }, [container, generation, launch.collaborationMode, launch.cwd, launch.profileId, launch.resumeSessionId, launch.ssh, launch.projectLaunch, launch.attachmentId]);

  useEffect(() => {
    themeMode.current = mode;
    transparentMode.current = transparent;
    handle.current?.applyTheme(xtermTheme(mode), transparent);
  }, [mode, transparent]);

  useEffect(() => {
    typographyConfig.current = typography;
    handle.current?.applyTypography(typography);
  }, [typography]);

  const restart = useCallback(() => {
    const stop = launch.tabId ? closeTerminalTab(launch.tabId) : sessionId.current ? closeTerminal(sessionId.current) : Promise.resolve();
    void stop.then(() => { attachment.current = null; sessionId.current = null; setSession(null); setError(null); setGeneration((value) => value + 1); })
      .catch((error) => setError(errorMessage(error)));
  }, [launch.tabId]);
  const reconnect = useCallback(() => { setError(null); setGeneration((value) => value + 1); }, []);
  const focus = useCallback(() => handle.current?.focus(), []);
  const sendText = useCallback((text: string) => handle.current?.sendText(text) ?? false, []);
  const commandTarget = useMemo(() => ({ focus, sendText }), [focus, sendText]);
  const close = useCallback(() => {
    const current = sessionId.current;
    if (current) {
      void closeTerminal(current).catch((error) => setError(errorMessage(error)));
    }
  }, []);

  return {
    daemonSessionId: session?.id ?? attachment.current ?? undefined,
    canReconnect: phase === "error" && !!attachment.current,
    reconnect,
    phase,
    error,
    shell: session?.shell ?? "system-default",
    cols: session?.cols ?? 0,
    rows: session?.rows ?? 0,
    lastInput,
    activity,
    agentState,
    search,
    commandTarget,
    restart,
    close,
    dismissError: () => setError(null),
  };
}
