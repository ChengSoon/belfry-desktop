import { describe, expect, it } from "vitest";
import { isCapability, RPC_METHODS } from "./protocol";
describe("Harness H0 protocol", () => {
  it("keeps the lifecycle method set stable", () => expect(RPC_METHODS).toEqual(["initialize", "session/start", "model/request", "tool/request", "context/select", "checkpoint/save", "cancel", "shutdown"]));
  it("accepts only declared capability kinds", () => { expect(isCapability({ kind: "command.exec", scope: ["git"] })).toBe(true); expect(isCapability({ kind: "shell" })).toBe(false); });
});
