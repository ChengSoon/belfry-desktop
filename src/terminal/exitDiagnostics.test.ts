import { afterEach, describe, expect, it } from "vitest";
import { diagnoseTerminalExit } from "./terminalController";
import { setLocalePreference } from "../i18n";

afterEach(() => setLocalePreference("zh-CN"));

describe("diagnoseTerminalExit", () => {
  it("explains a Codex readonly state database failure", () => {
    expect(diagnoseTerminalExit(1, "Codex couldn't start because its local database appears to be damaged.\nCause: attempt to write a readonly database")).toContain("无法写入本地状态数据库");
  });

  it("keeps normal process exits quiet", () => {
    expect(diagnoseTerminalExit(0, "")).toBeNull();
  });

  it("preserves a useful provider error when it is not recognized", () => {
    expect(diagnoseTerminalExit(1, "\u001b[31mError: authentication failed\u001b[0m")).toBe("Agent 启动失败：Error: authentication failed");
  });

  it("translates the diagnosis while preserving the Agent output verbatim", () => {
    setLocalePreference("en");
    expect(diagnoseTerminalExit(1, "readonly database")).toContain("cannot write to its local state database");
    expect(diagnoseTerminalExit(1, "Error: 原始 Agent 输出")).toBe("Agent failed to start: Error: 原始 Agent 输出");
    expect(diagnoseTerminalExit(7, "")).toBe("Agent process exited (code 7)");
  });
});
