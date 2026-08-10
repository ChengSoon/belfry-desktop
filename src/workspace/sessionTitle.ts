/** 敲了等于没敲的输入：不带信息，不该顶掉上一个更有意义的会话名。 */
const NOISE = new Set([
  "ls", "ll", "la", "pwd", "clear", "cls", "exit", "quit", "q",
  "yes", "no", "top", "htop", "reset", "history",
  // 目录信息已经写在侧栏的项目分组标题上了，再占一次会话名是重复。
  "cd",
]);

/** 上限宽度。视觉截断由侧栏的 text-overflow 负责，这里只拦住超长文本灌进 state 和 tooltip。 */
const MAX_WIDTH = 32;

/** 从一行原始输入提炼会话名；不够格返回 null，调用方保留上一个名字。 */
export function toSessionTitle(line: string): string | null {
  const text = line.trim().replace(/\s+/g, " ");
  if (displayWidth(text) < 3) return null;
  if (!/[\p{L}\p{N}]/u.test(text)) return null;
  if (/^\d+$/.test(text)) return null;

  const head = text.split(" ")[0].toLowerCase();
  if (NOISE.has(head)) return null;
  if (isSlashCommand(head)) return null;

  return truncate(text, MAX_WIDTH);
}

/** agent TUI 的 /clear、/model 不是提问；/usr/bin/foo 这类绝对路径是真命令，别误伤。 */
function isSlashCommand(head: string) {
  return /^\/[a-z][\w-]*$/.test(head);
}

/** 全角字符占两列，和终端一致——按列数算才对得上"一行能放多少字"的直觉。 */
function displayWidth(text: string) {
  let width = 0;
  for (const char of text) width += isWide(char) ? 2 : 1;
  return width;
}

function isWide(char: string) {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f9ff)
  );
}

function truncate(text: string, limit: number) {
  if (displayWidth(text) <= limit) return text;
  let width = 0;
  let result = "";
  // 按码点遍历，emoji 的代理对不会被从中间劈开。
  for (const char of text) {
    const next = width + (isWide(char) ? 2 : 1);
    if (next > limit - 1) break;
    result += char;
    width = next;
  }
  return `${result}…`;
}
