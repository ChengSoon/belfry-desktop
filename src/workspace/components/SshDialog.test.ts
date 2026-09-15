import { describe, expect, it } from "vitest";
import { parseSshTarget } from "./SshDialog";

describe("SSH dialog target parsing", () => {
  it("normalizes a complete SSH target", () => {
    expect(parseSshTarget({ host: " example.com ", user: " root ", port: "2222", password: " secret ", remember: true })).toEqual({
      host: "example.com",
      user: "root",
      port: 2222,
      password: " secret ",
      rememberPassword: true,
    });
  });

  it("keeps optional connection fields empty", () => {
    expect(parseSshTarget({ host: "prod", user: "", port: "", password: "", remember: false })).toEqual({
      host: "prod",
      user: null,
      port: null,
      password: null,
      rememberPassword: false,
    });
  });

  it("rejects unsafe host and user values", () => {
    expect(parseSshTarget({ host: "", user: "", port: "", password: "", remember: false })).toBe("主机不能为空");
    expect(parseSshTarget({ host: "-oProxyCommand=x", user: "", port: "", password: "", remember: false })).toBe("主机名不合法");
    expect(parseSshTarget({ host: "example.com", user: "root@admin", port: "", password: "", remember: false })).toBe("用户名不合法");
    expect(parseSshTarget({ host: "example.com", user: "-oProxyCommand=x", port: "", password: "", remember: false })).toBe("用户名不合法");
  });

  it("rejects ports outside the SSH range", () => {
    expect(parseSshTarget({ host: "example.com", user: "", port: "0", password: "", remember: false })).toBe("端口需在 1–65535 之间");
    expect(parseSshTarget({ host: "example.com", user: "", port: "65536", password: "", remember: false })).toBe("端口需在 1–65535 之间");
  });
});
