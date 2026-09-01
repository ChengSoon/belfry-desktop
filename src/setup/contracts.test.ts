import { describe, expect, it } from "vitest";
import { countChecks, type EnvironmentReport } from "./contracts";

describe("countChecks", () => {
  it("counts each diagnostic state", () => {
    const report: EnvironmentReport = {
      overall: "error",
      checkedAt: 1,
      checks: [
        { id: "one", label: "one", state: "ok", summary: "ok" },
        { id: "two", label: "two", state: "warning", summary: "warning" },
        { id: "three", label: "three", state: "error", summary: "error" },
      ],
    };

    expect(countChecks(report)).toEqual({ ok: 1, warning: 1, error: 1 });
  });
});
