import { Disclosure } from "../../components/controls/Disclosure";
import { useState } from "react";
import { formatMoment } from "../../usage/format";
import type { HistoryChange } from "./contracts";
import { changeLabel, resultLabel, type ChangeRecord } from "./model";

export function HistoryChanges({ records, onJump }: { records: ChangeRecord[]; onJump: (id: string) => void }) {
  if (!records.length) return <p className="history-detail__empty">本页没有可还原的文件修改记录。日志未保存编辑片段或 patch 时，无法展示历史 Diff。</p>;
  return <div className="history-changes">
    <p className="history-detail__note">本页 {new Set(records.map((record) => record.change.path)).size} 个文件 · {records.length} 次修改请求</p>
    {records.map((record, index) => <Disclosure className="history-change" key={record.id} defaultOpen={records.length === 1} title={<><strong title={record.change.path}>{record.change.path.split(/[\\/]/).at(-1) || "路径未记录"}</strong>
        <small className="history-change__path" title={record.change.path}>{record.change.path}</small><span>{changeLabel(record.change.kind)} · 第 {index + 1} 次</span>
        <small>{formatMoment(record.timestamp) ?? "时间未记录"} · {resultLabel(record)}</small></>}>
      {record.success === false ? <p className="history-detail__warning">该工具调用失败，此请求不能证明文件已修改。</p> : null}
      {record.change.originalPath ? <p className="history-detail__note">原路径：{record.change.originalPath}</p> : null}
      <ChangePreview change={record.change} />
      {record.truncated ? <p className="history-detail__warning">原记录较大，展示的内容可能不完整。</p> : null}
      <button type="button" className="history-detail__action" onClick={() => onJump(record.entryId)}>定位来源消息</button>
    </Disclosure>)}
  </div>;
}

export function ChangePreview({ change }: { change: HistoryChange }) {
  return <div className="history-change__content">
    <p className="history-detail__note">{change.note}</p>
    {change.patch !== null ? <PatchText text={change.patch} /> : <>
      {change.kind !== "write" ? <section><h4>修改前片段</h4><pre className="history-change__old">{change.oldText ?? "原内容未记录"}</pre></section> : null}
      <section><h4>{change.kind === "write" ? "写入内容" : "修改后片段"}</h4><pre className="history-change__new">{change.newText ?? "新内容未记录"}</pre></section>
    </>}
  </div>;
}

function PatchText({ text }: { text: string }) {
  const step = 200;
  const [limit, setLimit] = useState(step);
  const lines = text.split("\n");
  return <><pre className="history-change__patch" aria-label="日志中的 patch">{lines.slice(0, limit).map((line, index) =>
    <span key={index} className={line.startsWith("+") ? "is-add" : line.startsWith("-") ? "is-remove" : undefined}>{line}{"\n"}</span>)}</pre>
    {lines.length > limit ? <button type="button" className="history-detail__action" onClick={() => setLimit((current) => current + step)}>
      显示更多行（{limit} / {lines.length}）</button> : null}</>;
}
