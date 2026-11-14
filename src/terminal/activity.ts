import type { IDisposable, Terminal } from "@xterm/xterm";
import type { SessionActivity } from "./contracts";
import { usesTerminalStatus, type AgentKind } from "../agent/contracts";
import { nativeComposerEmpty, nativeTalking } from "./nativeScreen";
import { parseInteractionText } from "./choiceParser";
import { readScreenTail } from "./screen";
import { readInteractionScreen } from "./interactionScreen";
export { readScreenTail, screenTail } from "./screen";
export type { ScreenLine } from "./screen";
export { CHOICE_QUESTION } from "./choiceSignals";

/**
 * 仅为没有原生状态协议的 Agent 提供屏幕推断。Codex / Claude 不走这里。
 *
 * 认不出一律 idle：侧栏漏报一次没人受伤，误报几次用户就再也不信这个点了。
 */

/**
 * 没有原生状态协议的终端 Agent 使用的中断提示模式。
 * Codex / Claude 在调用这些屏幕判断前直接返回，状态只由协议报告控制。
 */
const TALKING = /esc to interrupt|\bto interrupt(?: and send immediately)?\)/i;

/** 其他 Agent 的活动扫描范围；选择内容解析使用自己的屏幕读取接口。 */
export const ACTIVITY_TAIL_LINES = 12;

/**
 * 其他 Agent 的输入区提示。原生协议会话独立跟踪用户对编辑器的占用。
 */
const COMPOSER_EMPTY = /\?\s+for shortcuts/i;

export function composerLooksEmpty(tail: string, agent?: AgentKind | null): boolean {
  if (usesTerminalStatus(agent)) return false;
  if (agent === "opencode" || agent === "kimi") return nativeComposerEmpty(tail, agent);
  return COMPOSER_EMPTY.test(tail);
}

/** 屏幕行的最小投影。剥掉 xterm 依赖，判定逻辑才测得动（仓库没装 jsdom）。 */
/** 等待选择优先于正在对话：权限框弹出来时 spinner 那行已经被擦掉了，实践中两者互斥。 */
export function detectActivity(tail: string, agent?: AgentKind | null): SessionActivity {
  if (usesTerminalStatus(agent)) return "talking";
  if (parseInteractionText(tail, agent)) return "awaiting-choice";
  return detectTalking(tail, agent);
}

function detectTalking(tail: string, agent?: AgentKind | null): SessionActivity {
  if (TALKING.test(tail) || nativeTalking(tail, agent)) return "talking";
  return "idle";
}

/** 其他 Agent 的屏幕扫描节流窗口。 */
const SCAN_INTERVAL_MS = 200;

/**
 * 盯着终端屏幕，状态变了才回调。
 *
 * 屏幕内容只可能因写入而改变——权限框出现的那一帧本身就是一次写入，生成结束后最后一次
 * 写入之后屏幕就不动了，光标闪烁不碰 buffer。所以挂在 onWriteParsed 上节流就够了，
 * 不需要常驻轮询：空闲会话一个计时器都不占。前沿覆盖"正在刷屏"，后沿覆盖"刚停下来"。
 *
 * 去重放在这里而不是靠上游：React 对同值 setState 是跑完组件函数之后才 bail out 的，
 * 每秒 5 次同值调用 × 十几个会话，白渲染的量不小。
 */
export function watchActivity(
  terminal: Terminal,
  onChange: (activity: SessionActivity) => void,
  agent?: AgentKind | null,
): IDisposable {
  if (usesTerminalStatus(agent)) {
    onChange("talking");
    return { dispose() {} };
  }
  let current: SessionActivity = "idle";
  let scannedAt = 0;
  let pending = 0;

  const scan = () => {
    pending = 0;
    scannedAt = Date.now();
    const next = readInteractionScreen(terminal, agent ?? null) ? "awaiting-choice"
      : detectTalking(readScreenTail(terminal, ACTIVITY_TAIL_LINES), agent);
    if (next === current) return;
    current = next;
    onChange(next);
  };

  const written = terminal.onWriteParsed(() => {
    const waited = Date.now() - scannedAt;
    if (waited >= SCAN_INTERVAL_MS) scan();
    else if (!pending) pending = window.setTimeout(scan, SCAN_INTERVAL_MS - waited);
  });

  return {
    dispose: () => {
      written.dispose();
      window.clearTimeout(pending);
      pending = 0;
    },
  };
}
