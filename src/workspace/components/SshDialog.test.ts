import { describe, expect, it } from "vitest";
import { parseSshTarget } from "./SshDialog";

describe("SSH dialog target parsing", () => {
  it("normalizes a complete SSH target", () => {
    expect(parseSshTarget(" example.com ", " root ", "2222", " secret ", true)).toEqual({
      host: "example.com",
      user: "root",
      port: 2222,
      password: " secret ",
      rememberPassword: true,
    });
  });

  it("keeps optional connection fields empty", () => {
    expect(parseSshTarget("prod", "", "", "", false)).toEqual({
      host: "prod",
      user: null,
      port: null,
      password: null,
      rememberPassword: false,
    });
  });

  it("rejects unsafe host and user values", () => {
    expect(parseSshTarget("", "", "", "", false)).toBe("主机不能为空");
    expect(parseSshTarget("-oProxyCommand=x", "", "", "", false)).toBe("主机名不合法");
    expect(parseSshTarget("example.com", "root@admin", "", "", false)).toBe("用户名不合法");
    expect(parseSshTarget("example.com", "-oProxyCommand=x", "", "", false)).toBe("用户名不合法");
  });

  it("rejects ports outside the SSH range", () => {
    expect(parseSshTarget("example.com", "", "0", "", false)).toBe("端口需在 1–65535 之间");
    expect(parseSshTarget("example.com", "", "65536", "", false)).toBe("端口需在 1–65535 之间");
  });
});
