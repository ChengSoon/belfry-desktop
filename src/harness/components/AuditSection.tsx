import { useCallback, useEffect, useState } from "react";
import { HarnessAuditClient, type AuditQuery, type HarnessAuditEvent } from "../auditClient";
import "./auditSection.css";

export function AuditSection({ client = new HarnessAuditClient() }: { client?: HarnessAuditClient }) {
  const [events, setEvents] = useState<HarnessAuditEvent[]>([]); const [query, setQuery] = useState<AuditQuery>({ limit: 100 }); const [error, setError] = useState<string>();
  const load = useCallback(async () => { if (!query.sessionId) { setEvents([]); setError(undefined); return; } try { setError(undefined); setEvents((await client.query(query)).events); } catch { setError("审计记录暂时不可用"); } }, [client, query]);
  useEffect(() => { void load(); }, [load]);
  return <section className="harness-audit" aria-labelledby="harness-audit-title"><header><h2 id="harness-audit-title">Harness 审计</h2><p>只读历史记录，应用重启后不会恢复执行。</p></header><div className="harness-audit__filters"><label>Session<input value={query.sessionId ?? ""} onChange={(e) => setQuery({ ...query, sessionId: e.target.value || undefined })} /></label><label>Worker<input value={query.workerId ?? ""} onChange={(e) => setQuery({ ...query, workerId: e.target.value || undefined })} /></label><button onClick={() => void load()} type="button">查询</button></div>{error ? <p role="alert">{error}</p> : null}<ol className="harness-audit__list">{events.map((event) => <li key={event.id}><div><strong>{event.phase}</strong><time>{new Date(event.timestamp).toLocaleString()}</time></div><code>{event.toolId}</code><span>{event.summary}{event.truncated ? "（已截断）" : ""}</span><small>{event.durationMs} ms{event.errorCode ? ` · ${event.errorCode}` : ""}</small></li>)}</ol></section>;
}
