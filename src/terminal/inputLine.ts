/** bracketed paste 的包裹符，粘贴内容夹在两者之间。 */
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export interface InputLineState {
  buffer: string;
  /** 密码提示后静默到下一次回车，避免把密码累积进来。 */
  muted: boolean;
  pasting: boolean;
}

export function emptyInputLine(): InputLineState {
  return { buffer: "", muted: false, pasting: false };
}

export function muteInputLine(state: InputLineState): InputLineState {
  return { ...state, buffer: "", muted: true };
}

/**
 * 把 xterm onData 的原始按键流还原成"用户提交了哪一行"。
 *
 * 一次喂入可能提交多行：未开 bracketed paste 时粘贴的多行文本会被 shell 逐行执行，
 * 这里如实还原成多次提交。
 *
 * 有意的近似：不跟踪光标位置。按左方向键回到行中间再打字，字符仍然追加到末尾，
 * 标题字序会有偏差。标题是摘要不是转录，为此实现一个完整行编辑器不划算。
 */
export function feedInputLine(state: InputLineState, data: string) {
  let { buffer, muted, pasting } = state;
  const submitted: string[] = [];
  let index = 0;

  while (index < data.length) {
    if (data.startsWith(PASTE_START, index)) {
      pasting = true;
      index += PASTE_START.length;
      continue;
    }
    if (data.startsWith(PASTE_END, index)) {
      pasting = false;
      index += PASTE_END.length;
      continue;
    }

    const start = index;
    const char = data[index];
    index += 1;

    // 粘贴区间内的换行不是提交：应用把整块当字面文本插入，用户还要再按一次回车。
    if (pasting) {
      if (!muted) buffer += isNewline(char) ? " " : char;
      continue;
    }
    if (isNewline(char)) {
      if (buffer.trim()) submitted.push(buffer);
      buffer = "";
      muted = false;
      continue;
    }
    if (char === "\x1b") {
      index = start + escapeLength(data, start);
      continue;
    }
    if (char === "\x7f" || char === "\b") {
      buffer = buffer.slice(0, -1);
      continue;
    }
    if (char === "\x03" || char === "\x04") {
      // 取消整行时密码提示也随之作废：不在这里解除 muted，之后的正常输入会被一直吞掉。
      buffer = "";
      muted = false;
      continue;
    }
    if (char === "\x15") {
      buffer = "";
      continue;
    }
    if (char === "\x17") {
      buffer = buffer.replace(/\s*\S+$/, "");
      continue;
    }
    if (char < " ") continue;
    // muted 期间干脆不落进缓冲区，密码连一瞬间都不该待在内存里。
    if (!muted) buffer += char;
  }

  return { state: { buffer, muted, pasting }, submitted };
}

function isNewline(char: string) {
  return char === "\r" || char === "\n";
}

/**
 * ESC 序列要整体跳过：方向键、功能键的参数字节本身是可打印字符，
 * 漏进缓冲区就会变成标题里的乱码。
 */
function escapeLength(data: string, start: number) {
  const next = data[start + 1];
  if (next !== "[" && next !== "O") return 2;
  // CSI 的参数与中间字节落在 0x20–0x3f，终结字节在 0x40–0x7e。
  let index = start + 2;
  while (index < data.length && data[index] >= " " && data[index] <= "?") index += 1;
  return index + 1 - start;
}
