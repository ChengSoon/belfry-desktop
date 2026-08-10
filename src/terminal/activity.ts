import type { IDisposable, Terminal } from "@xterm/xterm";
import type { SessionActivity } from "./contracts";

/**
 * 从渲染后的屏幕文本猜 Agent 眼下在干什么。信号全部来自 Claude Code / Codex 的界面
 * 文案，会随它们的版本漂移，所以只集中在下面这张表里，别散到别处去。
 *
 * 认不出一律 idle：侧栏漏报一次没人受伤，误报几次用户就再也不信这个点了。
 */

/** 生成中。Claude 的 `✻ Thinking… (esc to interrupt)` 和 Codex 的 `Working (Esc to interrupt)` 共用这句。 */
const TALKING = /esc to interrupt/i;

/** 权限框首句。完整一句话，偶然落进扫描窗口的概率低。 */
const CHOICE_QUESTION = /\bdo you want to\b/i;

/** 选择光标 + 编号：`❯ 1.` / `> 2)`。光标符是 TUI 独有的，markdown 有序列表渲染不出来。 */
const CHOICE_CURSOR = /^[❯›>]\s*\d+[.)]/;

/** 裸编号行。只用来确认光标那行不是孤例，绝不单独作判据——Agent 回答里的有序列表长这样。 */
const NUMBERED_OPTION = /^\s*\d+[.)]\s/;

/** shell 式确认。必须停在最后一行：`git`/`apt` 的说明文字里也带 (y/n)，但后面还跟着别的。 */
const CONFIRM_TAIL = /[([][yY]\s*\/\s*[nN][)\]]\s*[:：]?\s*$/;

/** 往上取几行。Claude 的 spinner 距底 6-8 行、权限框 8-10 行，12 有余量又不至于把正文摊进来。 */
export const ACTIVITY_TAIL_LINES = 12;

/** 屏幕行的最小投影。剥掉 xterm 依赖，判定逻辑才测得动（仓库没装 jsdom）。 */
export interface ScreenLine {
  text: string;
  isWrapped: boolean;
}

/**
 * 反折软换行后取屏幕尾部。
 *
 * `isWrapped` 的行是上一行被终端宽度切断的续行，必须无缝接回去——否则侧栏一拖宽，
 * `(esc to interrupt)` 就被劈成两行，锚点跟着消失，而且是随窗口宽度随机复现的那种漏判。
 *
 * 先修剪尾部空行再往上数：刚启动或刚 /clear 完屏幕大半是空的，固定取底部 N 行会全扫到空白。
 */
export function screenTail(lines: readonly ScreenLine[], maxLines: number): string {
  const logical: string[] = [];
  for (const line of lines) {
    if (line.isWrapped && logical.length > 0) logical[logical.length - 1] += line.text;
    else logical.push(line.text);
  }
  while (logical.length > 0 && logical[logical.length - 1].trim() === "") logical.pop();
  return logical.slice(Math.max(0, logical.length - maxLines)).join("\n");
}

/** 等待选择优先于正在对话：权限框弹出来时 spinner 那行已经被擦掉了，实践中两者互斥。 */
export function detectActivity(tail: string): SessionActivity {
  const lines = tail.split("\n");
  if (awaitsChoice(tail, lines)) return "awaiting-choice";
  if (TALKING.test(tail)) return "talking";
  return "idle";
}

function awaitsChoice(tail: string, lines: readonly string[]) {
  if (CHOICE_QUESTION.test(tail)) return true;
  if (CONFIRM_TAIL.test(lines[lines.length - 1] ?? "")) return true;
  // 光标行不匹配 NUMBERED_OPTION（它以 ❯ 开头），所以这里要求的是"还有另一个选项"。
  const cursor = lines.some((line) => CHOICE_CURSOR.test(line.trimStart()));
  return cursor && lines.some((line) => NUMBERED_OPTION.test(line));
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
): IDisposable {
  let current: SessionActivity = "idle";
  let scannedAt = 0;
  let pending = 0;

  const scan = () => {
    pending = 0;
    scannedAt = Date.now();
    const next = detectActivity(screenTail(readScreen(terminal), ACTIVITY_TAIL_LINES));
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

/** 用 baseY 而非 viewportY：用户往上滚屏不该改变判定。alternate buffer 里 baseY 恒为 0，同一段循环通吃。 */
function readScreen(terminal: Terminal): ScreenLine[] {
  const buffer = terminal.buffer.active;
  const lines: ScreenLine[] = [];
  for (let y = 0; y < terminal.rows; y++) {
    const line = buffer.getLine(buffer.baseY + y);
    if (line) lines.push({ text: line.translateToString(true), isWrapped: line.isWrapped });
  }
  return lines;
}
