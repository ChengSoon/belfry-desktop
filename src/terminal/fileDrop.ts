import type { TerminalSession } from "./contracts";

/**
 * 文件拖进终端时只插入路径，不附带回车，避免意外执行命令。
 *
 * PowerShell 和 POSIX shell 都用单引号获得最可预测的字面量语义；cmd.exe
 * 不把单引号当引号，因此退回双引号。Windows 文件名本身不能包含双引号。
 */
export function formatDroppedPaths(paths: string[], session: TerminalSession) {
  const quote = isCmd(session.shell)
    ? quoteForCmd
    : session.platform === "windows"
      ? quoteForPowerShell
      : quoteForPosixShell;
  const formatted = paths.filter(Boolean).map(quote).join(" ");
  return formatted ? `${formatted} ` : "";
}

export function pointInsideRect(
  point: { x: number; y: number },
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
) {
  return point.x >= rect.left && point.x <= rect.right
    && point.y >= rect.top && point.y <= rect.bottom;
}

function isCmd(shell: string) {
  return /(^|[\\/])cmd(?:\.exe)?$/i.test(shell);
}

function quoteForPowerShell(path: string) {
  return `'${path.replaceAll("'", "''")}'`;
}

function quoteForPosixShell(path: string) {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

function quoteForCmd(path: string) {
  return `"${path}"`;
}
