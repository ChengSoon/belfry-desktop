import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTheme } from "../theme/ThemeProvider";
import { xtermTheme } from "../theme/xtermTheme";
import { closeTerminal } from "./api";
import { type TerminalLaunch, type TerminalPhase, type TerminalSession } from "./contracts";
import { errorMessage, mountTerminal, type TerminalHandle } from "./terminalController";

interface TerminalViewModel {
  phase: TerminalPhase;
  error: string | null;
  shell: string;
  cols: number;
  rows: number;
  restart: () => void;
  close: () => void;
}

export function useTerminalSession(
  container: RefObject<HTMLDivElement | null>,
  launch: TerminalLaunch = { profileId: "system-default", cwd: null },
): TerminalViewModel {
  const { mode } = useTheme();
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<TerminalPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const sessionId = useRef<string | null>(null);
  const handle = useRef<TerminalHandle | null>(null);
  // 主题不能进挂载 effect 的依赖，否则换肤会重挂终端、连带杀掉 PTY 会话。
  const themeMode = useRef(mode);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const mounted = mountTerminal(host, launch, {
      onPhase: setPhase,
      onError: setError,
      onSession: (value) => {
        sessionId.current = value?.id ?? null;
        setSession(value);
      },
    });
    // 与挂载同一个同步块内上色，浏览器来不及用默认配色画出一帧。
    mounted.applyTheme(xtermTheme(themeMode.current));
    handle.current = mounted;
    return () => {
      handle.current = null;
      mounted.dispose();
    };
  }, [container, generation, launch.cwd, launch.profileId]);

  useEffect(() => {
    themeMode.current = mode;
    handle.current?.applyTheme(xtermTheme(mode));
  }, [mode]);

  const restart = useCallback(() => setGeneration((value) => value + 1), []);
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
    restart,
    close,
  };
}
