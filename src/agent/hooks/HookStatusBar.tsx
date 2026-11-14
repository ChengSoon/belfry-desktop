import { t, useTranslation } from "../../i18n";
import type { SessionActivity, TerminalPhase } from "../../terminal/contracts";
import type { HookSnapshot } from "./contracts";
import { usesTerminalStatus, type AgentKind } from "../contracts";
import { terminalStatusFor } from "../programStatus";
import { terminalStatusLabel } from "../programStatusLabel";
import "./hooks.css";

interface Props { snapshot: HookSnapshot | null; activity: SessionActivity; phase: TerminalPhase; recovering?: boolean; agent?: AgentKind }
export function HookStatusBar({ snapshot, activity, phase, recovering = false, agent }: Props) {
  useTranslation();
  const kind = agent ?? snapshot?.agent;
  const protocol = usesTerminalStatus(kind);
  const state = protocol ? terminalStatusFor(kind, snapshot) : snapshot;
  const source = protocol ? "terminal_protocol" : state?.source ?? "screen_heuristic";
  const sourceName = { hook: "Hook", terminal_protocol: "OSC 7501", screen_heuristic: t("agent.HookStatusBar.text_e269887a9d"), process: t("agent.HookStatusBar.text_b5ece7e2e3") }[source];
  const reason = protocol ? terminalStatusLabel(kind, snapshot) : source === "screen_heuristic"
    ? { idle: t("agent.HookStatusBar.text_b073db9c0b"), talking: t("agent.HookStatusBar.text_3b7e27cb43"), "awaiting-choice": t("agent.HookStatusBar.text_c634a6dafd") }[activity]
    : state?.reason;
  const status = phase === "creating" ? (recovering ? t("agent.HookStatusBar.text_dfba1899c6") : t("agent.HookStatusBar.text_087739b986")) : phase === "error" ? t("agent.HookStatusBar.text_41a841de20") : phase === "exited" ? t("agent.HookStatusBar.text_899df7e244") : reason;
  const details = [state?.programStatus?.title, source === "terminal_protocol" ? reason : state?.reason ?? t("agent.HookStatusBar.text_ec3770c468"), state?.session ? t("agent.HookStatusBar.text_e9cb72a260", { id: state.session.id }) : null]
    .filter(Boolean).join(" · ");
  return <div className="hook-status-bar" data-source={source} role="status" title={details}>
    <span className="hook-status-bar__source">{sourceName}</span><span>{status}</span>
    {state?.programStatus?.progress != null ? <span>{state.programStatus.progress}%</span> : null}
  </div>;
}
