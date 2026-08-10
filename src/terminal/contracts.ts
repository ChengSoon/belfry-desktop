export type Platform = "macos" | "windows";
export type TerminalPhase = "idle" | "creating" | "running" | "exited" | "error";
/**
 * 会话在干什么，和 TerminalPhase（进程生命周期）正交：phase 一直是 running 的会话，
 * activity 会在生成 / 等按键 / 闲着之间来回翻。
 *
 * 刻意不叫 AgentState，也不用 awaiting_input——roadmap 的 AgentLifecycleEvent 占了那套词，
 * 那是 hooks 通道就绪后的精确事件源。这里是屏幕文本猜出来的近似值，两者不能混。
 */
export type SessionActivity = "idle" | "talking" | "awaiting-choice";
export type LaunchProfileId = "system-default" | "agent:codex" | "agent:claude";

export interface TerminalLaunch {
  profileId: LaunchProfileId;
  cwd: string | null;
}

/**
 * 当前主题的默认前景 / 背景色（`#rrggbb`），交给 PTY 层应答子进程的 OSC 10/11 查询。
 *
 * 这件事必须落在 Rust 侧：Codex 这类 TUI 只给 100ms 窗口，绕一圈
 * `PTY → IPC → xterm.js → IPC → PTY` 经常超时；Windows 上超时的后果不是"没颜色"
 * 而是"猜错颜色"——Codex 会退回读 ConPTY 的黑色调色板，把输入框画成黑块。
 */
export interface TerminalPalette {
  foreground: string;
  background: string;
}

export interface CreateTerminalRequest {
  platform: Platform;
  profileId: LaunchProfileId;
  cwd: string | null;
  command: null;
  env: Record<string, string>;
  cols: number;
  rows: number;
  elevation: "normal";
  palette: TerminalPalette;
}

export interface TerminalSession {
  id: string;
  platform: Platform;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  status: "starting" | "running" | "exited" | "failed";
  exitCode: number | null;
}

export type TerminalEvent =
  | {
      kind: "output";
      sessionId: string;
      sequence: number;
      bytes: number[];
      eof: boolean;
    }
  | {
      kind: "exit";
      sessionId: string;
      exitCode: number;
      reason: "normal" | "terminated" | "spawn_failed" | "io_failed";
    };

export function createTerminalRequest(
  cols: number,
  rows: number,
  launch: TerminalLaunch,
  palette: TerminalPalette,
  userAgent = navigator.userAgent,
): CreateTerminalRequest {
  return {
    platform: userAgent.includes("Windows") ? "windows" : "macos",
    profileId: launch.profileId,
    cwd: launch.cwd,
    command: null,
    env: {},
    cols,
    rows,
    elevation: "normal",
    palette,
  };
}

export function createDefaultRequest(
  cols: number,
  rows: number,
  palette: TerminalPalette,
  userAgent = navigator.userAgent,
) {
  return createTerminalRequest(
    cols,
    rows,
    { profileId: "system-default", cwd: null },
    palette,
    userAgent,
  );
}
