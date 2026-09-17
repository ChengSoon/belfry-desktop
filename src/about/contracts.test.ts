import { describe, expect, it } from "vitest";
import { countUpgradable, RELEASE_LABEL, type AgentRelease } from "./contracts";

function release(state: AgentRelease["state"]): AgentRelease {
  return {
    kind: "codex",
    displayName: "Codex",
    command: "codex",
    executable: null,
    currentVersion: null,
    latestVersion: null,
    package: null,
    state,
    notice: null,
    installCommand: null,
  };
}

describe("about contracts", () => {
  it("counts only upgradable releases", () => {
    expect(countUpgradable([release("ready"), release("upgradable"), release("missing")])).toBe(1);
    expect(countUpgradable([release("upgradable"), release("upgradable")])).toBe(2);
    expect(countUpgradable([release("ready"), release("unknown")])).toBe(0);
    expect(countUpgradable([])).toBe(0);
  });

  it("labels every release state", () => {
    for (const state of ["ready", "upgradable", "missing", "unmanaged", "unknown"] as const) {
      expect(RELEASE_LABEL[state]).toBeTruthy();
    }
  });
});
