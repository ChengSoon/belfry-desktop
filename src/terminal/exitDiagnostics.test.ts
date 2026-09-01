import { describe, expect, it } from "vitest";
import { diagnoseTerminalExit } from "./terminalController";

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
});
