import type { HookSnapshot } from "../../agent/hooks/contracts";
import type { TerminalTheme } from "../../theme/xtermTheme";
import type { TypographyRuntime } from "../../typography/contracts";
import type { SessionActivity, TerminalPhase, TerminalSession } from "../contracts";
import type { TerminalSearchController } from "../search";

export interface MountCallbacks {
  onPhase: (phase: TerminalPhase) => void;
  onError: (error: string | null) => void;
  onSession: (session: TerminalSession | null) => void;
  /** 用户提交的一行原始输入，供上层提炼会话名。 */
  onInput: (line: string) => void;
  /** 终端输出的文本片段，供协作协议等结构化通道消费。 */
  onOutput?: (text: string) => void;
  /** 会话在生成 / 等按键 / 闲着，供侧栏显示。只有 Agent 会话会翻。 */
  onActivity: (activity: SessionActivity) => void;
  onAgentState?: (snapshot: HookSnapshot | null) => void;
  /** 终端输出中的项目文件路径，交给工作区打开只读预览。 */
  onOpenFile: (path: string, line: number | null) => void;
  /** Ctrl/Cmd+F 请求打开搜索浮层，由 React 负责呈现。 */
  onSearchRequest: () => void;
}

export interface TerminalHandle {
  /**
   * 换肤走这里，不要重新挂载或重复创建输出连接。
   *
   * `theme` 始终传**不透明的基准主题**，是否透明由 `transparent` 单独给。
   * 背景色有三个下游只认 `#rrggbb`——PTY 的 OSC 应答、Codex 的输入区配色、
   * 以及会话创建请求——把 rgba 混进来会静默失效或直接抛错。
   */
  applyTheme: (theme: TerminalTheme, transparent: boolean) => void;
  /** 字体变化只刷新 xterm 并重新 fit，保持当前输出连接。 */
  applyTypography: (config: TypographyRuntime) => void;
  search: TerminalSearchController;
  focus: () => void;
  /** Composer 走可信的 xterm 输入通道提交多行文本，不直接绕过终端写 PTY。 */
  sendText: (text: string) => boolean;
  dispose: () => void;
}
