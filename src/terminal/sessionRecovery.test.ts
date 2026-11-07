import { expect, it } from "vitest";
import { isMissingTerminalSession, isRetryableTerminalConnectionError } from "./controller/diagnostics";

it("recognizes structured and legacy missing-session errors", () => {
  expect(isMissingTerminalSession({ code: "SESSION_MISSING", message: "gone" })).toBe(true);
  expect(isMissingTerminalSession({ code: "IO_ERROR", message: "原后台任务已不存在。请重启" })).toBe(true);
  expect(isMissingTerminalSession("[IO_ERROR] 原后台任务已不存在。请重启")).toBe(true);
});

it("retries structured transport failures and legacy disconnection messages", () => {
  for (const error of [
    { code: "IO_ERROR", message: "backend unavailable", retryable: true },
    { code: "TIMEOUT", message: "deadline reached", retryable: true },
    new Error("network unavailable"), "后台连接失败：Connection reset by peer",
    "[IO_ERROR] 后台连接失败：timeout", "bridge closed",
  ]) expect(isRetryableTerminalConnectionError(error)).toBe(true);
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
