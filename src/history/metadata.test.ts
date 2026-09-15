import { describe, expect, it } from "vitest";
import { loadMetadata, normalizeTags, saveSessionMetadata, sessionKey } from "./metadata";

function storageWith(value: string | null = null) {
  let current = value;
  return {
    getItem: () => current,
    setItem: (_key: string, next: string) => { current = next; },
  };
}

describe("history metadata", () => {
  it("keeps same-named Codex and Claude sessions independent after reload", () => {
    const storage = storageWith();
    const codex = { agent: "codex" as const, id: "same-id" };
    const claude = { agent: "claude" as const, id: "same-id" };
    saveSessionMetadata({ storage, session: codex, patch: { favorite: true, tags: ["回归"] } });
    saveSessionMetadata({ storage, session: claude, patch: { tags: ["文档"] } });
    const restored = loadMetadata(storage);
    expect(restored[sessionKey(codex)]).toEqual({ favorite: true, tags: ["回归"] });
    expect(restored[sessionKey(claude)]).toEqual({ favorite: false, tags: ["文档"] });
  });

  it("merges a favorite change without losing tags or other session metadata", () => {
    const storage = storageWith();
    const first = { agent: "codex" as const, id: "first" };
    const second = { agent: "codex" as const, id: "second" };
    saveSessionMetadata({ storage, session: first, patch: { favorite: true, tags: ["待验证"] } });
    saveSessionMetadata({ storage, session: second, patch: { favorite: true } });
    saveSessionMetadata({ storage, session: first, patch: { favorite: false } });
    const restored = loadMetadata(storage);
    expect(restored[sessionKey(first)]).toEqual({ favorite: false, tags: ["待验证"] });
    expect(restored[sessionKey(second)]?.favorite).toBe(true);
  });

  it("refuses to overwrite corrupt or newer metadata", () => {
    for (const original of ["broken", '{"version":2,"entries":{}}']) {
      const storage = storageWith(original);
      expect(() => saveSessionMetadata({
        storage, session: { agent: "codex", id: "a" }, patch: { favorite: true },
      })).toThrow();
      expect(storage.getItem()).toBe(original);
    }
  });

  it("normalizes Chinese separators and duplicate tags without hiding excessive input", () => {
    expect(normalizeTags(" 回归， Review ;review； 界面\n回归 ")).toEqual(["回归", "Review", "界面"]);
    expect(() => normalizeTags("很".repeat(65))).toThrow();
  });

  it("surfaces persistence errors instead of reporting a successful favorite", () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error("disk unavailable"); } };
    expect(() => saveSessionMetadata({
      storage, session: { agent: "claude", id: "a" }, patch: { favorite: true },
    })).toThrow("disk unavailable");
  });
});
