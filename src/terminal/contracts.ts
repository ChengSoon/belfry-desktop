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
export type ShellProfileId =
  | "system-default"
  | "shell:zsh"
  | "shell:bash"
  | "shell:fish"
  | "shell:pwsh"
  | "shell:powershell"
  | "shell:cmd"
  | "shell:wsl"
  | "shell:git-bash";
export type LaunchProfileId = ShellProfileId | "agent:codex" | "agent:claude" | "ssh";

export interface ShellProfile {
  id: ShellProfileId;
  available: boolean;
  executable: string | null;
  isDefault: boolean;
  reason: string | null;
}

export function isShellProfileId(value: string): value is ShellProfileId {
  return [
    "system-default",
    "shell:zsh",
    "shell:bash",
    "shell:fish",
    "shell:pwsh",
    "shell:powershell",
    "shell:cmd",
    "shell:wsl",
    "shell:git-bash",
  ].includes(value);
}

export function shellProfileLabel(id: ShellProfileId): string {
  return {
    "system-default": "系统默认",
    "shell:zsh": "zsh",
    "shell:bash": "bash",
    "shell:fish": "fish",
    "shell:pwsh": "PowerShell 7",
    "shell:powershell": "Windows PowerShell",
    "shell:cmd": "命令提示符",
    "shell:wsl": "WSL",
    "shell:git-bash": "Git Bash",
  }[id];
}

/** SSH 连接目标。密码不随工作区状态持久化，只在启动时经 SshLaunch 传递。 */
export interface SshTarget {
  host: string;
  user: string | null;
  port: number | null;
}

/** 一次 SSH 启动的完整参数：目标 + 本次密码与「记住密码」开关。 */
export interface SshLaunch extends SshTarget {
  /** 本次连接使用的密码；不随工作区状态持久化，勾选记住时由后端写入系统钥匙串。 */
  password: string | null;
  /** 为 true 时把 password 存进系统钥匙串，之后的连接自动取用。 */
  rememberPassword: boolean;
}

/** `user@host` 或裸 `host`，会话标签和会话信息共用。 */
export function sshDisplayName(target: SshTarget): string {
  return target.user ? `${target.user}@${target.host}` : target.host;
}

export interface TerminalLaunch {
  profileId: LaunchProfileId;
  cwd: string | null;
  /** 继续某条历史会话：Codex/Claude 的 resume 参数。null 表示普通新会话。 */
  resumeSessionId: string | null;
  /** SSH 会话的连接目标；其他会话为 null。 */
  ssh: SshLaunch | null;
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
  resume: string | null;
  ssh: SshLaunch | null;
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

/** 可由 Composer 等宿主 UI 驱动的最小终端输入面。 */
export interface TerminalCommandTarget {
  focus: () => void;
  /** 通过 xterm 的 paste + 用户回车通道提交；PTY 未就绪时返回 false。 */
  sendText: (text: string) => boolean;
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
    resume: launch.resumeSessionId,
    ssh: launch.ssh,
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
    { profileId: "system-default", cwd: null, resumeSessionId: null, ssh: null },
    palette,
    userAgent,
  );
}
