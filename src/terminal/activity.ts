import type { IDisposable, Terminal } from "@xterm/xterm";
import type { SessionActivity } from "./contracts";
import type { AgentKind } from "../agent/contracts";
import { nativeComposerEmpty, nativeTalking } from "./nativeScreen";
import { parseInteractionText } from "./choiceParser";
import { readScreenTail } from "./screen";
import { readInteractionScreen } from "./interactionScreen";
export { readScreenTail, screenTail } from "./screen";
export type { ScreenLine } from "./screen";
export { CHOICE_QUESTION } from "./choiceSignals";

/**
 * 从渲染后的屏幕文本猜 Agent 眼下在干什么。信号全部来自 Claude Code / Codex 的界面
 * 文案，会随它们的版本漂移，所以只集中在下面这张表里，别散到别处去。
 *
 * 认不出一律 idle：侧栏漏报一次没人受伤，误报几次用户就再也不信这个点了。
 */

/**
 * 生成中。Claude 的 `✻ Thinking… (esc to interrupt)` 和 Codex 的 `Working (Esc to interrupt)` 共用这句。
 * Codex 0.16x 起按键名单独着色、可能画成 `⎋` 之类的符号，只剩 ` to interrupt)` 是稳定的文本；
 * 排队消息的提示 `(press esc to interrupt and send immediately)` 也只在生成中出现。
 */
const TALKING = /esc to interrupt|\bto interrupt(?: and send immediately)?\)/i;

/**
 * 权限框首句。完整一句话，偶然落进扫描窗口的概率低。Claude 用 `Do you want to …`；
 * Codex 0.16x 用 `Would you like to run the following command?` 这一组。
 */
/** 往上取几行。Claude 的 spinner 距底 6-8 行、权限框 8-10 行，12 有余量又不至于把正文摊进来。 */
export const ACTIVITY_TAIL_LINES = 12;

/**
 * 输入区是空的。Claude Code 和 Codex 都只在输入框没内容时才在底栏显示 `? for shortcuts`，
 * 打了字就换成别的提示——投递队列靠它判断「贴进去的任务已经被提交走了」。
 */
const COMPOSER_EMPTY = /\?\s+for shortcuts/i;

export function composerLooksEmpty(tail: string, agent?: AgentKind | null): boolean {
  if (agent === "opencode" || agent === "kimi") return nativeComposerEmpty(tail, agent);
  return COMPOSER_EMPTY.test(tail);
}

/** 屏幕行的最小投影。剥掉 xterm 依赖，判定逻辑才测得动（仓库没装 jsdom）。 */
/** 等待选择优先于正在对话：权限框弹出来时 spinner 那行已经被擦掉了，实践中两者互斥。 */
export function detectActivity(tail: string, agent?: AgentKind | null): SessionActivity {
  if (parseInteractionText(tail, agent)) return "awaiting-choice";
  return detectTalking(tail, agent);
}

function detectTalking(tail: string, agent?: AgentKind | null): SessionActivity {
  if (TALKING.test(tail) || nativeTalking(tail, agent)) return "talking";
  return "idle";
}

/** 扫描节流窗口。Claude 的 spinner 约 10Hz，低于 150ms 就是在陪它空转。 */
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
