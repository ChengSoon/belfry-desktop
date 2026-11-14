import { AGENT_METADATA, isAgentKind } from "./contracts";
import type { HookSnapshot } from "./hooks/contracts";
import { terminalStatusFor } from "./programStatus";
import { t } from "../i18n";

export function terminalStatusLabel(agent: unknown, snapshot: HookSnapshot | null | undefined): string {
  const status = terminalStatusFor(agent, snapshot)?.programStatus;
  if (!status || status.state === "clear") {
    return t("agent.HookStatusBar.protocolWaiting", { agent: isAgentKind(agent) ? AGENT_METADATA[agent].name : "Agent" });
  }
  if (status.message) return status.message;
  switch (status.state) {
    case "idle": return t("agent.HookStatusBar.text_b073db9c0b");
    case "working": return t("agent.HookStatusBar.text_3b7e27cb43");
    case "done": return t("agent.HookStatusBar.protocolDone");
    case "error": return t("agent.HookStatusBar.protocolError");
    case "blocked":
      if (status.kind === "permission") return t("agent.HookStatusBar.protocolPermission");
      if (status.kind === "question") return t("agent.HookStatusBar.protocolQuestion");
      if (status.kind === "auth") return t("agent.HookStatusBar.protocolAuth");
      return t("agent.HookStatusBar.text_c634a6dafd");
    default: return t("agent.HookStatusBar.protocolWaiting", { agent: isAgentKind(agent) ? AGENT_METADATA[agent].name : "Agent" });
  }
}
