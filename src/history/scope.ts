import type { AgentKind } from "../agent/contracts";

export interface HistoryAgentScope {
  agent: AgentKind;
  generation: number;
}

export function advanceHistoryAgentScope(
  current: HistoryAgentScope,
  agent: AgentKind,
): HistoryAgentScope {
  return current.agent === agent
    ? current
    : { agent, generation: current.generation + 1 };
}

export function isCurrentHistoryAgentScope(
  current: HistoryAgentScope,
  operation: HistoryAgentScope,
) {
  return current.agent === operation.agent
    && current.generation === operation.generation;
}
