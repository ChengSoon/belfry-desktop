import { describe, expect, it } from "vitest";
import { toSessionTitle } from "./sessionTitle";

describe("session title extraction", () => {
  it("takes prompts and informative commands as-is", () => {
    expect(toSessionTitle("帮我修复登录超时")).toBe("帮我修复登录超时");
    expect(toSessionTitle("pnpm dev")).toBe("pnpm dev");
    expect(toSessionTitle("  git   log --oneline  ")).toBe("git log --oneline");
  });

  it("rejects input that carries no information", () => {
    // 返回 null = 保留上一个名字，而不是退回 Shell 01。
    for (const line of ["", "   ", "y", "n", "yes", "3", "!!", "ls", "ls -la", "cd src/app", "clear"]) {
      expect(toSessionTitle(line)).toBeNull();
    }
  });

  it("rejects agent slash commands but keeps absolute paths", () => {
    expect(toSessionTitle("/clear")).toBeNull();
    expect(toSessionTitle("/model opus")).toBeNull();
    expect(toSessionTitle("/usr/local/bin/node server.js")).toBe("/usr/local/bin/node server.js");
  });

  it("truncates by display width, counting full-width chars as two columns", () => {
    const long = "帮我把这个项目里所有的接口都补上错误处理和重试逻辑";
    const title = toSessionTitle(long);
    expect(title?.endsWith("…")).toBe(true);
    expect([...(title ?? "")].length).toBe(16); // 15 个全角字 + 省略号
    expect(toSessionTitle("a".repeat(40))).toBe(`${"a".repeat(31)}…`);
  });
});
