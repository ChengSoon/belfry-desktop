import { expect, it } from "vitest";
import { isMissingTerminalSession } from "./controller/diagnostics";

it("recognizes structured and legacy missing-session errors", () => {
  expect(isMissingTerminalSession({ code: "SESSION_MISSING", message: "gone" })).toBe(true);
  expect(isMissingTerminalSession({ code: "IO_ERROR", message: "原后台任务已不存在。请重启" })).toBe(true);
  expect(isMissingTerminalSession("[IO_ERROR] 原后台任务已不存在。请重启")).toBe(true);
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
