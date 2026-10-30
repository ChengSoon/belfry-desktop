import { describe, expect, it } from "vitest";
import type { AgentAvailability, AgentKind } from "../agent/contracts";
import { ROOM_TEMPLATES, resolveTemplateRoles } from "./templates";

const TEMPLATE = ROOM_TEMPLATES[0];

function agent(kind: AgentKind, available: boolean, label: string): AgentAvailability {
  // 解析只看 kind 与 available；其余字段不参与，构造时省略。
  return { descriptor: { displayName: label }, kind, available } as AgentAvailability;
}

describe("resolveTemplateRoles", () => {
  it("推荐的 Agent 可用时按推荐落座", () => {
    const roster = resolveTemplateRoles(TEMPLATE, [agent("claude", true, "Claude"), agent("codex", true, "Codex")]);
    expect(roster).toEqual([
      { role: "实现", duty: "把改动落到代码里", kind: "claude", agentLabel: "Claude" },
      { role: "审查", duty: "从另一个模型的角度复查改动", kind: "codex", agentLabel: "Codex" },
    ]);
  });

  it("推荐的不可用时退回第一个可用的", () => {
    const roster = resolveTemplateRoles(TEMPLATE, [agent("claude", true, "Claude"), agent("codex", false, "Codex")]);
    expect(roster.map((entry) => entry.kind)).toEqual(["claude", "claude"]);
  });

  it("一个可用的都没有时返回空清单，只建房间", () => {
    expect(resolveTemplateRoles(TEMPLATE, [agent("claude", false, "Claude")])).toEqual([]);
  });
});
