/** 将 CLI 启动失败从“终端已退出”提升为用户可执行的诊断。 */
export function diagnoseTerminalExit(exitCode: number, output: string): string | null {
  if (exitCode === 0) return null;
  const clean = stripTerminalAnsi(output).replace(/\r/g, "\n");
  if (/readonly database|read-only database|local database appears to be damaged|failed to initialize state/i.test(clean)) {
    return t("terminal.diagnostics.databaseReadOnly");
  }
  const lines = clean
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = [...lines].reverse().find((line) => /^(error|fatal|错误|失败)[:：]?/i.test(line) || /couldn't start|operation not permitted|failed to initialize/i.test(line));
  return detail ? t("terminal.diagnostics.startFailed", { detail }) : t("terminal.diagnostics.processExited", { code: exitCode });
}

function stripTerminalAnsi(value: string) {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "");
}

export function errorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? `[${String(error.code)}] ` : "";
  return `${code}${localizedErrorMessage(error)}`;
}

/** 只在后台明确确认任务已丢失时允许重建；网络或权限错误不能触发新进程。 */
export function isMissingTerminalSession(error: unknown): boolean {
  // A displayed error can carry the stable code even after its text is translated.
  if (typeof error === "string" && /^\[SESSION_MISSING\](?:\s|$)/u.test(error)) return true;
  if (typeof error === "object" && error && "code" in error) {
    if (error.code === "SESSION_MISSING") return true;
    if (error.code !== "IO_ERROR") return false;
  }
  const message = error instanceof Error ? error.message
    : typeof error === "object" && error && "message" in error ? String(error.message) : String(error);
  return /^(?:\[(?:IO_ERROR|SESSION_MISSING)\]\s*)?原后台任务已不存在。/u.test(message);
}

/** 只重试传输故障；旧后台的字符串错误同样不能把鉴权、项目或协议问题当成断线。 */
export function isRetryableTerminalConnectionError(error: unknown): boolean {
  if (!error || isMissingTerminalSession(error)) return false;
  const record = typeof error === "object" ? error as { code?: unknown; retryable?: unknown } : null;
  // Classify the wire diagnostic; translating display text must not change recovery decisions.
  const message = error instanceof Error ? error.message
    : typeof error === "object" && "message" in error ? String(error.message) : String(error);
  const code = record?.code ?? /^\[([A-Z0-9_]+)\]/u.exec(message)?.[1];
  const transport = typeof code === "string" && transportErrorCodes.has(code);
  if (record?.retryable === false || (code && code !== "IO_ERROR" && code !== "TIMEOUT" && !transport)) return false;
  if (/permission|denied|unauthori[sz]ed|forbidden|invalid (?:token|argument)|(?:version|identity).*(?:invalid|mismatch|does not match|do not match)|(?:project|task type).*(?:changed|mismatch|does not match)|(?:message|response).*(?:size limit|format.*not supported)|权限|鉴权|认证|身份.*(?:校验|无效|不匹配)|项目或类型已改变|项目.*不匹配|后台(?:消息|响应).*(?:格式|大小)|后台协议版本不匹配/iu.test(message)) return false;
  if (transport || code === "TIMEOUT" || (code === "IO_ERROR" && record?.retryable === true)) return true;
  return /后台连接|终端输出连接已关闭|network|connection|connect (?:failed|error)|socket|timed?\s*out|timeout|broken pipe|bridge closed|unexpected eof|ECONN|EPIPE/iu.test(message);
}

const transportErrorCodes = new Set([
  "TERMINAL_BACKGROUND_SERVICE_CONNECTION_FAILED",
  "TERMINAL_THE_TERMINAL_OUTPUT_CONNECTION_IS_CLOSED",
  "TERMINAL_THE_BACKGROUND_SERVICE_CONNECTION_WAS_INTERRUPTED_RECONNECT",
  "TERMINAL_THE_BACKGROUND_SERVICE_IS_UNAVAILABLE",
  "TERMINAL_THE_BACKGROUND_RELAY_IS_UNAVAILABLE",
  "TERMINAL_THE_BACKGROUND_SERVICE_IS_QUITTING_TRY_AGAIN",
  "TERMINAL_THE_BACKGROUND_OUTPUT_BATCH_EXCEEDS_THE_CONSUMPTION",
  "TERMINAL_TERMINAL_OUTPUT_ACKNOWLEDGEMENT_TIMED_OUT_RECONNECT_TO",
]);
import { errorMessage as localizedErrorMessage, t } from "../../i18n";
