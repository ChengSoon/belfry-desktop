import { expect, it } from "vitest";
import { isMissingTerminalSession, isRetryableTerminalConnectionError } from "./controller/diagnostics";

it("recognizes structured and legacy missing-session errors", () => {
  expect(isMissingTerminalSession({ code: "SESSION_MISSING", message: "gone" })).toBe(true);
  expect(isMissingTerminalSession({ code: "IO_ERROR", message: "原后台任务已不存在。请重启" })).toBe(true);
  expect(isMissingTerminalSession("[IO_ERROR] 原后台任务已不存在。请重启")).toBe(true);
  expect(isMissingTerminalSession("[SESSION_MISSING] The original background task no longer exists.")).toBe(true);
});

it("retries structured transport failures and legacy disconnection messages", () => {
  for (const error of [
    { code: "IO_ERROR", message: "backend unavailable", retryable: true },
    { code: "TIMEOUT", message: "deadline reached", retryable: true },
    new Error("network unavailable"), "后台连接失败：Connection reset by peer",
    "[IO_ERROR] 后台连接失败：timeout", "bridge closed",
  ]) expect(isRetryableTerminalConnectionError(error)).toBe(true);
});

it("retries the stable transport codes in either language without recreating the session", () => {
  for (const code of [
    "TERMINAL_BACKGROUND_SERVICE_CONNECTION_FAILED",
    "TERMINAL_THE_TERMINAL_OUTPUT_CONNECTION_IS_CLOSED",
    "TERMINAL_THE_BACKGROUND_SERVICE_CONNECTION_WAS_INTERRUPTED_RECONNECT",
    "TERMINAL_THE_BACKGROUND_SERVICE_IS_UNAVAILABLE",
    "TERMINAL_THE_BACKGROUND_RELAY_IS_UNAVAILABLE",
    "TERMINAL_THE_BACKGROUND_SERVICE_IS_QUITTING_TRY_AGAIN",
    "TERMINAL_THE_BACKGROUND_OUTPUT_BATCH_EXCEEDS_THE_CONSUMPTION",
    "TERMINAL_TERMINAL_OUTPUT_ACKNOWLEDGEMENT_TIMED_OUT_RECONNECT_TO",
  ]) {
    for (const message of ["The background connection was interrupted.", "后台连接已中断。", "detail from another locale"]) {
      const error = { code, message, retryable: true };
      expect(isRetryableTerminalConnectionError(error), code).toBe(true);
      expect(isMissingTerminalSession(error), code).toBe(false);
      expect(isRetryableTerminalConnectionError({ ...error, retryable: false }), code).toBe(false);
    }
  }
});

it("rejects permanent failures nested in stable connection errors with either language", () => {
  for (const message of [
    "Background service connection failed: permission denied",
    "Background service is unavailable: The background service version or identity is invalid.",
    "Background service connection failed: The background service protocol versions do not match.",
    "Background service connection failed: The background task project or type changed.",
    "Background service connection failed: The background service message exceeds the size limit.",
    "后台连接失败：后台版本或身份无效，请结束旧后台后重试",
  ]) expect(isRetryableTerminalConnectionError({ code: "TERMINAL_BACKGROUND_SERVICE_CONNECTION_FAILED", message, retryable: true }), message).toBe(false);
});

it("never retries authorization, project, protocol, process-exit or explicitly permanent failures", () => {
  for (const error of [
    { code: "PERMISSION_DENIED", message: "network unavailable", retryable: true },
    { code: "INVALID_ARGUMENT", message: "connection unavailable", retryable: true },
    { code: "PROCESS_EXITED", message: "connection unavailable", retryable: true },
    { code: "IO_ERROR", message: "connection reset", retryable: false },
    { code: "SESSION_MISSING", message: "gone", retryable: true },
    "[PERMISSION_DENIED] connection unavailable", "[IO_ERROR] 后台连接失败：permission denied",
    "后台身份校验失败", "后台连接失败：Unauthorized", "后台任务的项目或类型已改变",
    { code: "IO_ERROR", message: "后台版本或身份无效，请结束旧后台后重试", retryable: true },
    { code: "IO_ERROR", message: "后台协议版本不匹配", retryable: true },
    "后台响应格式不支持", "原后台任务已不存在。", "find executable failed", null,
  ]) expect(isRetryableTerminalConnectionError(error)).toBe(false);
});

it("never recreates sessions for generic network, auth, project or file failures", () => {
  for (const error of [
    { code: "IO_ERROR", message: "后台连接失败：timeout" },
    { code: "NOT_FOUND", message: "找不到 codex 程序" },
    { code: "PERMISSION_DENIED", message: "原后台任务已不存在。" },
    { code: "INVALID_ARGUMENT", message: "后台任务的项目或类型已改变" },
    new Error("network unavailable"), null,
  ]) expect(isMissingTerminalSession(error)).toBe(false);
});
