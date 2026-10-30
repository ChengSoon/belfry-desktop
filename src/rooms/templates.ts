import type { AgentAvailability, AgentKind } from "../agent/contracts";

/**
 * 房间模板：纯前端常量，不落库。
 *
 * 「一键建出常用班子」的最小实现。角色带一个**推荐** Agent——装了就按推荐
 * （跨模型审查这类组合才有意义），没装退回第一个可用的，预览会如实显示将用谁。
 */
export interface RoomTemplateRole {
  role: string;
  duty: string;
  kind: AgentKind;
}

export interface RoomTemplate {
  id: string;
  name: string;
  roles: RoomTemplateRole[];
}

export const ROOM_TEMPLATES: RoomTemplate[] = [
  {
    id: "implement-review",
    name: "实现 + 审查",
    roles: [
      { role: "实现", duty: "把改动落到代码里", kind: "claude" },
      { role: "审查", duty: "从另一个模型的角度复查改动", kind: "codex" },
    ],
  },
  {
    id: "fix-verify",
    name: "修复 + 验证",
    roles: [
      { role: "修复", duty: "定位并修掉问题", kind: "claude" },
      { role: "验证", duty: "在独立视角下复现并确认修好", kind: "codex" },
    ],
  },
];

export interface ResolvedTemplateRole {
  role: string;
  duty: string;
  kind: AgentKind;
  agentLabel: string;
}

/** 把模板落到这台机器上：推荐的 Agent 不在就退回第一个可用的；一个都没有时返回空清单。 */
export function resolveTemplateRoles(template: RoomTemplate, agents: AgentAvailability[]): ResolvedTemplateRole[] {
  const available = agents.filter((agent) => agent.available);
  if (available.length === 0) return [];
  return template.roles.map((role) => {
    const chosen = available.find((agent) => agent.kind === role.kind) ?? available[0];
    return { role: role.role, duty: role.duty, kind: chosen.kind, agentLabel: chosen.descriptor.displayName };
  });
}
