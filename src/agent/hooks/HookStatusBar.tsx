import { t, useTranslation } from "../../i18n";
import type { SessionActivity, TerminalPhase } from "../../terminal/contracts";
import type { HookSnapshot } from "./contracts";
import "./hooks.css";

interface Props { snapshot: HookSnapshot | null; activity: SessionActivity; phase: TerminalPhase; recovering?: boolean }
export function HookStatusBar({ snapshot, activity, phase, recovering = false }: Props) {
  useTranslation();
  const source = snapshot?.source ?? "screen_heuristic";
  const sourceName = { hook: "Hook", screen_heuristic: t("agent.HookStatusBar.text_e269887a9d"), process: t("agent.HookStatusBar.text_b5ece7e2e3") }[source];
  const reason = source === "screen_heuristic"
    ? { idle: t("agent.HookStatusBar.text_b073db9c0b"), talking: t("agent.HookStatusBar.text_3b7e27cb43"), "awaiting-choice": t("agent.HookStatusBar.text_c634a6dafd") }[activity]
    : snapshot?.reason;
  const status = phase === "creating" ? (recovering ? t("agent.HookStatusBar.text_dfba1899c6") : t("agent.HookStatusBar.text_087739b986")) : phase === "error" ? t("agent.HookStatusBar.text_41a841de20") : phase === "exited" ? t("agent.HookStatusBar.text_899df7e244") : reason;
  const details = [snapshot?.reason ?? t("agent.HookStatusBar.text_ec3770c468"), snapshot?.session ? t("agent.HookStatusBar.text_e9cb72a260", { id: snapshot.session.id }) : null]
    .filter(Boolean).join(" · ");
  return <div className="hook-status-bar" data-source={source} role="status" title={details}>
    <span className="hook-status-bar__source">{sourceName}</span><span>{status}</span>
  </div>;
}
