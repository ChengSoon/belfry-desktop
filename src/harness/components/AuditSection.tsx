import { useFeedback, formatDateTime, formatNumber, t, useTranslation } from "../../i18n";
import { useCallback, useEffect, useState } from "react";
import { HarnessAuditClient, type AuditQuery, type HarnessAuditEvent } from "../auditClient";
import "./auditSection.css";

export function AuditSection({ client = new HarnessAuditClient() }: { client?: HarnessAuditClient }) {
  useTranslation();
  const [events, setEvents] = useState<HarnessAuditEvent[]>([]); const [query, setQuery] = useState<AuditQuery>({ limit: 100 }); const [error, setError] = useFeedback<string>();
  const load = useCallback(async () => { if (!query.sessionId) { setEvents([]); setError(undefined); return; } try { setError(undefined); setEvents((await client.query(query)).events); } catch { setError(() => t("harness.AuditSection.text_500e1cfd15")); } }, [client, query]);
  useEffect(() => { void load(); }, [load]);
  return <section className="harness-audit" aria-labelledby="harness-audit-title"><header><h2 id="harness-audit-title">{t("harness.AuditSection.text_65971e1570")}</h2><p>{t("harness.AuditSection.text_2b0ccd71a8")}</p></header><div className="harness-audit__filters"><label>Session<input value={query.sessionId ?? ""} onChange={(e) => setQuery({ ...query, sessionId: e.target.value || undefined })} /></label><label>Worker<input value={query.workerId ?? ""} onChange={(e) => setQuery({ ...query, workerId: e.target.value || undefined })} /></label><button onClick={() => void load()} type="button">{t("harness.AuditSection.text_bcd6771e08")}</button></div>{error ? <p role="alert">{error}</p> : null}<ol className="harness-audit__list">{events.map((event) => <li key={event.id}><div><strong>{event.phase}</strong><time>{formatDateTime(event.timestamp)}</time></div><code>{event.toolId}</code><span>{event.summary}{event.truncated ? t("harness.AuditSection.text_77cde5d253") : ""}</span><small>{formatNumber(event.durationMs)} ms{event.errorCode ? ` · ${event.errorCode}` : ""}</small></li>)}</ol></section>;
}
