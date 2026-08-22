import { describe, expect, it } from "vitest";
import { createDefaultRequest, createTerminalRequest } from "./contracts";

const PALETTE = { foreground: "#26272b", background: "#fafafa" };

describe("createDefaultRequest", () => {
  it("maps Windows user agents to the Windows backend", () => {
    const request = createDefaultRequest(100, 30, PALETTE, "Windows NT 10.0");
    expect(request.platform).toBe("windows");
    expect(request.cols).toBe(100);
    expect(request.rows).toBe(30);
  });

  it("uses macOS for the supported non-Windows desktop build", () => {
    expect(createDefaultRequest(80, 24, PALETTE, "Macintosh").platform).toBe("macos");
  });

  // PTY 层靠它应答子进程的 OSC 11 查询；漏传就会退回让子进程自己猜，
  // Windows 上猜出来的是黑色。
  it("carries the terminal palette down to the backend", () => {
    expect(createDefaultRequest(80, 24, PALETTE, "Macintosh").palette).toEqual(PALETTE);
  });

  it("carries the ssh target down to the backend", () => {
    const request = createTerminalRequest(
      80,
      24,
      {
        tabId: null,
        profileId: "ssh",
        cwd: "file:///demo",
        resumeSessionId: null,
        ssh: {
          host: "example.com",
          user: "root",
          port: 2222,
          password: "secret",
          rememberPassword: true,
        },
      },
      PALETTE,
      "Macintosh",
    );
    expect(request.profileId).toBe("ssh");
    expect(request.ssh).toEqual({
      host: "example.com",
      user: "root",
      port: 2222,
      password: "secret",
      rememberPassword: true,
    });
  });

  it("keeps non-ssh requests free of an ssh target", () => {
    expect(createDefaultRequest(80, 24, PALETTE, "Macintosh").ssh).toBeNull();
  });
});
