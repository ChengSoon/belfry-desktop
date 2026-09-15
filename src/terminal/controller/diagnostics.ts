/** 将 CLI 启动失败从“终端已退出”提升为用户可执行的诊断。 */
export function diagnoseTerminalExit(exitCode: number, output: string): string | null {
  if (exitCode === 0) return null;
  const clean = stripTerminalAnsi(output).replace(/\r/g, "\n");
  if (/readonly database|read-only database|local database appears to be damaged|failed to initialize state/i.test(clean)) {
    return "Agent 启动失败：Codex 无法写入本地状态数据库（~/.codex/state_5.sqlite）。请检查 ~/.codex 的读写权限后重试。";
  }
  const lines = clean
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = [...lines].reverse().find((line) => /^(error|fatal|错误|失败)[:：]?/i.test(line) || /couldn't start|operation not permitted|failed to initialize/i.test(line));
  return detail ? `Agent 启动失败：${detail}` : `Agent 进程已退出（代码 ${exitCode}）`;
}

function stripTerminalAnsi(value: string) {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "");
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const code = "code" in error ? `[${String(error.code)}] ` : "";
    return `${code}${String(error.message)}`;
  }
  return String(error);
}
