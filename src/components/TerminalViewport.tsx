import { useEffect, useMemo, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import "../terminal/terminal.css";
import type { SessionActivity, TerminalLaunch, TerminalPhase } from "../terminal/contracts";
import { useTerminalSession } from "../terminal/useTerminalSession";

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
}

export function TerminalViewport({ visible, launch, onSnapshot }: TerminalViewportProps) {
  const terminalHost = useRef<HTMLDivElement>(null);
  // resumeSessionId 与 cwd/profileId 一样会触发 PTY 重启，必须一起参与记忆。
  const stableLaunch = useMemo(
    () => launch,
    [launch.cwd, launch.profileId, launch.resumeSessionId],
  );
  const session = useTerminalSession(terminalHost, stableLaunch);
  const dormant = session.phase === "exited" || session.phase === "error";

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
      {dormant ? (
        <div className="terminal-alert" role="status">
          <span>{session.error ?? "进程已退出"}</span>
          <button onClick={session.restart} type="button">重启</button>
        </div>
      ) : null}
    </section>
  );
}
