/**
 * 只认"正在等你输入密码"的提示，所以每条都锚在行尾：
 * 日志里出现的 password 字样后面还跟着内容，不会以冒号收尾。
 */
const PROMPTS = [
  /\bpassword\b[^:：]{0,40}[:：]\s*$/i,
  /\bpassphrase\b[^:：]{0,48}[:：]\s*$/i,
  /密\s*码[^:：]{0,12}[:：]\s*$/,
  /\benter\s+pin\b[^:：]{0,20}[:：]\s*$/i,
  /\bverification\s+code\b[^:：]{0,24}[:：]\s*$/i,
];

/**
 * PTY 输出是不是停在密码提示上。命中后要让输入采集静默，
 * 否则 sudo 密码会被当成"最新一条输入"写进会话名。
 */
export function looksLikePasswordPrompt(text: string): boolean {
  const lastLine = text.replace(/\s+$/, "").split(/[\r\n]/).pop() ?? "";
  return PROMPTS.some((pattern) => pattern.test(lastLine));
}
