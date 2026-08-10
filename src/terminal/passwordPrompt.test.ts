import { describe, expect, it } from "vitest";
import { looksLikePasswordPrompt } from "./passwordPrompt";

describe("password prompt detection", () => {
  it("catches the prompts that actually wait for a secret", () => {
    const prompts = [
      "[sudo] password for cheng: ",
      "Password:",
      "cheng@host's password: ",
      "Enter passphrase for key '/Users/cheng/.ssh/id_ed25519': ",
      "请输入密码：",
      "Enter PIN:",
      "Verification code: ",
    ];
    for (const prompt of prompts) expect(looksLikePasswordPrompt(prompt)).toBe(true);
  });

  it("only looks at the trailing line", () => {
    expect(looksLikePasswordPrompt("$ sudo -v\n[sudo] password for cheng: ")).toBe(true);
    // 提示行滚上去之后就不该再静默，否则后面的正常输入全都进不了标题。
    expect(looksLikePasswordPrompt("[sudo] password for cheng:\nSorry, try again.\n$ ")).toBe(false);
  });

  it("does not fire on log lines that merely mention a password", () => {
    const noise = [
      "config.password: redacted",
      "Password changed successfully",
      "error: authentication failed, check your password",
      "$ ",
    ];
    for (const line of noise) expect(looksLikePasswordPrompt(line)).toBe(false);
  });
});
