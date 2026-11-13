import { Notice } from "../../components/Notice";
import { t, useTranslation } from "../../i18n";
import { Disclosure } from "../../components/controls/Disclosure";
import { useState } from "react";
import { formatMoment } from "../../usage/format";
import type { HistoryChange } from "./contracts";
import { changeLabel, resultLabel, type ChangeRecord } from "./model";

export function HistoryChanges({ records, onJump }: { records: ChangeRecord[]; onJump: (id: string) => void }) {
  useTranslation();
  if (!records.length) return <p className="history-detail__empty">{t("history.HistoryChanges.text_25d43695b0")}</p>;
  return <div className="history-changes">
    <p className="history-detail__note">{t("history.HistoryChanges.pageSummary", { files: new Set(records.map((record) => record.change.path)).size, changes: records.length })}</p>
    {records.map((record, index) => <Disclosure className="history-change" key={record.id} defaultOpen={records.length === 1} title={<><strong title={record.change.path}>{record.change.path.split(/[\\/]/).at(-1) || t("history.HistoryChanges.text_7d687ee82a")}</strong>
        <small className="history-change__path" title={record.change.path}>{record.change.path}</small><span>{t("history.HistoryChanges.text_343c179b85", { kind: changeLabel(record.change.kind), index: index + 1 })}</span>
        <small>{formatMoment(record.timestamp) ?? t("history.HistoryChanges.text_a07a9e97ea")} · {resultLabel(record)}</small></>}>
      {/* 历史记录里的失败是已发生的事实，不是正在发生的告警：用 status 而不是 alert，
          否则展开多条失败记录时读屏会被连续打断（code-review L2）。颜色仍保留 danger。 */}
      {record.success === false ? <Notice className="history-detail__warning" role="status">{t("history.HistoryChanges.text_2dcc0386e2")}</Notice> : null}
      {record.change.originalPath ? <p className="history-detail__note">{t("history.HistoryChanges.text_9f70948d1c", { originalPath: record.change.originalPath })}</p> : null}
      <ChangePreview change={record.change} />
      {record.truncated ? <Notice className="history-detail__warning" tone="warning">{t("history.HistoryChanges.text_071eab29ca")}</Notice> : null}
      <button type="button" className="history-detail__action" onClick={() => onJump(record.entryId)}>{t("history.HistoryChanges.text_0583462641")}</button>
    </Disclosure>)}
  </div>;
}

export function ChangePreview({ change }: { change: HistoryChange }) {
  useTranslation();
  return <div className="history-change__content">
    <p className="history-detail__note">{change.note}</p>
    {change.patch !== null ? <PatchText text={change.patch} /> : <>
      {change.kind !== "write" ? <section><h4>{t("history.HistoryChanges.text_6e2cb80fb1")}</h4><pre className="history-change__old">{change.oldText ?? t("history.HistoryChanges.text_6851bd0b86")}</pre></section> : null}
      <section><h4>{change.kind === "write" ? t("history.HistoryChanges.text_0b93e5466d") : t("history.HistoryChanges.text_c581d4c4b1")}</h4><pre className="history-change__new">{change.newText ?? t("history.HistoryChanges.text_fae11820c0")}</pre></section>
    </>}
  </div>;
}

function PatchText({ text }: { text: string }) {
  useTranslation();
  const step = 200;
  const [limit, setLimit] = useState(step);
  const lines = text.split("\n");
  return <><pre className="history-change__patch" aria-label={t("history.HistoryChanges.text_128e5cbc11")}>{lines.slice(0, limit).map((line, index) =>
    <span key={index} className={line.startsWith("+") ? "is-add" : line.startsWith("-") ? "is-remove" : undefined}>{line}{"\n"}</span>)}</pre>
    {lines.length > limit ? <button type="button" className="history-detail__action" onClick={() => setLimit((current) => current + step)}>{t("history.HistoryChanges.text_2c9d98b691", { limit: limit, count: lines.length })}</button> : null}</>;
}
