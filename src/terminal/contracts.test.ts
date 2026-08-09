import { describe, expect, it } from "vitest";
import { createDefaultRequest } from "./contracts";

describe("createDefaultRequest", () => {
  it("maps Windows user agents to the Windows backend", () => {
    const request = createDefaultRequest(100, 30, "Windows NT 10.0");
    expect(request.platform).toBe("windows");
    expect(request.cols).toBe(100);
    expect(request.rows).toBe(30);
  });

  it("uses macOS for the supported non-Windows desktop build", () => {
    expect(createDefaultRequest(80, 24, "Macintosh").platform).toBe("macos");
  });
});
