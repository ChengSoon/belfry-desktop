import { describe, expect, it } from "vitest";
import { parseRawManifest } from "./raw";

const valid = JSON.stringify({ schemaVersion: 1, id: "example.review", name: "Review", version: "1.0.0", author: "Team", compatibility: { pluginApi: 1, minAppVersion: "0.19.0" }, contributes: { templates: [{ id: "review", kind: "prompt", name: "Review", steps: [{ id: "step", text: "Review {{scope}}" }] }] } });
describe("raw plugin manifest boundary", () => {
  it("rejects escaped duplicate keys before JSON object construction", () => {
    expect(() => parseRawManifest('{"schemaVersion":1,"id":"example.review","name":"x","version":"1.0.0","author":"a","compatibility":{"pluginApi":1,"minAppVersion":"0.19.0"},"contributes":{"templates":[{"id":"x","kind":"prompt","name":"x","steps":[{"id":"s","text":"x"}]}]},"i\\u0064":"other"}', "0.19.0")).toThrow("重复");
  });
  it("accepts valid manifests and rejects trailing JSON", () => {
    expect(parseRawManifest(valid, "0.19.0").id).toBe("example.review");
    expect(() => parseRawManifest(`${valid} {}`, "0.19.0")).toThrow();
  });
});
