import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useBackground } from "../background/BackgroundProvider";
import { useTheme } from "../theme/ThemeProvider";
import { xtermTheme } from "../theme/xtermTheme";
import { useTypography } from "../typography/TypographyProvider";
import { closeTerminal } from "./api";
import {
  type SessionActivity,
  type TerminalCommandTarget,
  type TerminalLaunch,
  type TerminalPhase,
  type TerminalSession,
} from "./contracts";
import { errorMessage, mountTerminal, type TerminalHandle } from "./terminalController";
import type { TerminalSearchController } from "./search";

interface TerminalViewModel {
  phase: TerminalPhase;
  error: string | null;
  shell: string;
  cols: number;
  rows: number;
  /** 用户最近提交的一行原始输入，未做任何提炼。 */
  lastInput: string | null;
  /** 会话在生成 / 等按键 / 闲着。Shell 会话恒为 idle。 */
  activity: SessionActivity;
  search: TerminalSearchController | null;
  commandTarget: TerminalCommandTarget;
  restart: () => void;
  close: () => void;
}

export function useTerminalSession(
  container: RefObject<HTMLDivElement | null>,
  launch: TerminalLaunch = {
    profileId: "system-default",
    cwd: null,
    resumeSessionId: null,
    ssh: null,
  },
  onSearchRequest?: () => void,
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
  const [search, setSearch] = useState<TerminalSearchController | null>(null);
  const sessionId = useRef<string | null>(null);
  const handle = useRef<TerminalHandle | null>(null);
  // 主题、背景和字体都不能进挂载 effect 的依赖，否则设置外观会重挂终端、连带杀掉 PTY 会话。
  const themeMode = useRef(mode);
  const transparentMode = useRef(transparent);
  const typographyConfig = useRef(typography);
  const searchRequest = useRef(onSearchRequest);
  searchRequest.current = onSearchRequest;

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const mounted = mountTerminal(
      host,
      launch,
      xtermTheme(themeMode.current),
      transparentMode.current,
      typographyConfig.current,
      {
        onPhase: setPhase,
        onError: setError,
        onSession: (value) => {
          sessionId.current = value?.id ?? null;
          setSession(value);
        },
        onInput: setLastInput,
        onActivity: setActivity,
        onSearchRequest: () => searchRequest.current?.(),
      },
    );
    handle.current = mounted;
    setSearch(mounted.search);
    return () => {
      handle.current = null;
      setSearch(null);
      mounted.dispose();
    };
  }, [container, generation, launch.cwd, launch.profileId, launch.resumeSessionId, launch.ssh]);

  useEffect(() => {
    themeMode.current = mode;
    transparentMode.current = transparent;
    handle.current?.applyTheme(xtermTheme(mode), transparent);
  }, [mode, transparent]);

  useEffect(() => {
    typographyConfig.current = typography;
    handle.current?.applyTypography(typography);
  }, [typography]);

  const restart = useCallback(() => setGeneration((value) => value + 1), []);
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
    phase,
    error,
    shell: session?.shell ?? "system-default",
    cols: session?.cols ?? 0,
    rows: session?.rows ?? 0,
    lastInput,
    activity,
    search,
    commandTarget,
    restart,
    close,
  };
}
