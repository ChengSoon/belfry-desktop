import { describe, expect, it } from "vitest";
import { canRoute, globalRoutes, OFFICIAL, projectRoutes, routeCount } from "./model";

const order = ["claude", "codex", "pi"] as const;
const relay = { id: "", name: "Relay", baseUrl: "https://relay.invalid/v1", hasApiKey: true, model: "gpt-5", createdAt: 1 };

describe("model routing", () => {
  it("merges the same relay saved under several agents into one jack and keeps per-agent ids", () => {
    const model = globalRoutes(order, [
      { kind: "claude", providers: [{ ...relay, id: "c1" }], currentId: "c1" },
      { kind: "codex", providers: [{ ...relay, id: "x9" }], currentId: null },
    ]);
    expect(model.services.map((service) => service.key)).toEqual([OFFICIAL, expect.stringContaining("Relay")]);
    const service = model.services[1];
    expect(service.ids).toEqual({ claude: "c1", codex: "x9" });
    expect(model.agents.map((agent) => [agent.kind, agent.current === OFFICIAL ? "official" : agent.current ? "relay" : null, agent.available]))
      .toEqual([["claude", "relay", true], ["codex", "official", true], ["pi", null, false]]);
    expect(routeCount(model, service.key)).toBe(1);
    expect(canRoute(service, "codex")).toBe(true);
    expect(canRoute(service, "pi")).toBe(false);
  });

  it("puts following agents on the follow-global jack and marks overrides, missing and keyless choices", () => {
    const model = projectRoutes(order, [
      { kind: "claude", providerId: null, source: "global", effectiveName: "Relay", missing: false, choices: [{ id: "c1", name: "Relay", baseUrl: relay.baseUrl, model: "gpt-5", configured: true }] },
      { kind: "codex", providerId: "x2", source: "project", effectiveName: "Other", missing: true, choices: [{ id: "x3", name: "Keyless", baseUrl: "https://k.invalid", model: "", configured: false }] },
    ]);
    const [claude, codex, pi] = model.agents;
    expect(claude).toMatchObject({ overridden: false, current: OFFICIAL });
    expect(codex).toMatchObject({ overridden: true, missing: true, current: null });
    expect(pi.available).toBe(false);
    expect(canRoute(model.services.find((service) => service.name === "Keyless")!, "codex")).toBe(false);
  });
});
