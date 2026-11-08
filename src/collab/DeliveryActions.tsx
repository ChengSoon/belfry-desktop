import { useState } from "react";
import { useTranslation } from "../i18n";
import type { TaskView } from "./api";

export type DeliveryDecision = "submitted" | "cancelled";
export function DeliveryActions({ task, pending, onResolve, onLocate }: {
  task: TaskView; pending: boolean;
  onResolve?: (task: TaskView, decision: DeliveryDecision) => Promise<void>;
  onLocate?: (tabId: string) => void;
}) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<{ task: TaskView; decision: DeliveryDecision } | null>(null);
  const decision = selection?.decision;
  if (task.delivery?.phase !== "uncertain" || ["done", "failed", "abandoned"].includes(task.state)) return null;
  const canLocate = Boolean(task.toTabId && onLocate);
  return <div className="collab-delivery-actions">
    <p>{t("collab.delivery.checkFirst")}</p>
    <div className="collab-event__actions">
      <button className="collab-button" data-delivery-action="locate" disabled={!canLocate} onClick={() => task.toTabId && onLocate?.(task.toTabId)} type="button">{t("collab.delivery.locate")}</button>
      <button className="collab-button" data-delivery-action="confirm" disabled={pending || !onResolve || !task.delivery.attemptId} onClick={() => setSelection({ task, decision: "submitted" })} type="button">{t("collab.delivery.confirmSubmitted")}</button>
      <button className="collab-button collab-button--danger" data-delivery-action="abandon" disabled={pending || !onResolve || !task.delivery.attemptId} onClick={() => setSelection({ task, decision: "cancelled" })} type="button">{t("collab.delivery.abandon")}</button>
    </div>
    {!canLocate ? <small>{t("collab.delivery.targetUnavailable")}</small> : null}
    {decision ? <div className="collab-delivery-confirm" role="group" aria-label={t("collab.delivery.confirmTitle")}>
      <p>{t(decision === "submitted" ? "collab.delivery.confirmBody" : "collab.delivery.abandonBody")}</p>
      <div className="collab-event__actions">
        <button className="collab-button" disabled={pending} onClick={() => setSelection(null)} type="button">{t("common.cancel")}</button>
        <button className="collab-button collab-button--primary" data-delivery-action="resolve" disabled={pending} onClick={() => { if (selection) void onResolve?.(selection.task, selection.decision); setSelection(null); }} type="button">
          {t(decision === "submitted" ? "collab.delivery.confirmVerified" : "collab.delivery.confirmAbandon")}
        </button>
      </div>
    </div> : null}
  </div>;
}
