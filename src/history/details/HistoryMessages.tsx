import { Disclosure } from "../../components/controls/Disclosure";
import type { HistoryEntry } from "./contracts";
import { formatMoment } from "../../usage/format";
import { highlightedParts } from "../search";

export function HistoryMessages({ entries, selectedId, query }: { entries: HistoryEntry[]; selectedId: string | null; query: string }) {
  if (!entries.length) return <p className="history-detail__empty">本页没有可展示的消息。原始日志可能仅包含状态记录，或缺少受支持的内容。</p>;
  return <ol className="history-messages">{entries.map((entry) => <li key={entry.id}>
    <article id={`history-message-${entry.id}`} tabIndex={-1} className={`history-message${entry.id === selectedId ? " is-target" : ""}`}>
      <header><strong>{({ user: "用户", assistant: "助手", tool: "工具结果" } as Record<string, string>)[entry.role] ?? "记录"}</strong>
        <time>{formatMoment(entry.timestamp) ?? "时间未记录"}</time></header>
      {entry.text ? <p className="history-message__text"><MessageText text={entry.text} query={query} /></p> : null}
      {entry.tools.map((tool, index) => <Disclosure className="history-tool" key={`${tool.id}-${index}`} title={<><strong>{tool.name}</strong><span>{tool.kind === "call" ? "调用参数" : tool.success === false ? "执行失败" : "返回结果"}</span></>}>
        <pre>{tool.text || "日志没有可展示的文本内容"}</pre>
      </Disclosure>)}
      {entry.omittedBlocks ? <p className="history-detail__note">{entry.omittedBlocks} 个附件或非文本内容未展开。</p> : null}
      {entry.truncated ? <p className="history-detail__warning" role="status">这条记录较大，部分内容已截断。</p> : null}
    </article>
  </li>)}</ol>;
}

function MessageText({ text, query }: { text: string; query: string }) {
  const parts = highlightedParts(text, query);
  const limit = 300;
  return <>{parts.slice(0, limit).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}
    {parts.slice(limit).map((part) => part.text).join("")}</>;
}
