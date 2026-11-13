import { Notice } from "../../components/Notice";
import { t, useTranslation } from "../../i18n";
import { Disclosure } from "../../components/controls/Disclosure";
import type { HistoryEntry } from "./contracts";
import { formatMoment } from "../../usage/format";
import { highlightedParts } from "../search";

export function HistoryMessages({ entries, selectedId, query }: { entries: HistoryEntry[]; selectedId: string | null; query: string }) {
  useTranslation();
  if (!entries.length) return <p className="history-detail__empty">{t("history.HistoryMessages.text_11763327cc")}</p>;
  return <ol className="history-messages">{entries.map((entry) => <li key={entry.id}>
    <article id={`history-message-${entry.id}`} tabIndex={-1} className={`history-message${entry.id === selectedId ? " is-target" : ""}`}>
      <header><strong>{({ user: t("history.HistoryMessages.text_0d0e1a86b3"), assistant: t("history.HistoryMessages.text_e5ce5f6da7"), tool: t("history.HistoryMessages.text_d7fea1743a") } as Record<string, string>)[entry.role] ?? t("history.HistoryMessages.text_9fad24e2c3")}</strong>
        <time>{formatMoment(entry.timestamp) ?? t("history.HistoryMessages.text_a07a9e97ea")}</time></header>
      {entry.text ? <p className="history-message__text"><MessageText text={entry.text} query={query} /></p> : null}
      {entry.tools.map((tool, index) => <Disclosure className="history-tool" key={`${tool.id}-${index}`} title={<><strong>{tool.name}</strong><span>{tool.kind === "call" ? t("history.HistoryMessages.text_93410c30cb") : tool.success === false ? t("history.HistoryMessages.text_9344597efd") : t("history.HistoryMessages.text_1d0f87003f")}</span></>}>
        <pre>{tool.text || t("history.HistoryMessages.text_0f1f634eda")}</pre>
      </Disclosure>)}
      {entry.omittedBlocks ? <p className="history-detail__note">{t("history.HistoryMessages.text_0fc60b2994", { count: entry.omittedBlocks })}</p> : null}
      {entry.truncated ? <Notice className="history-detail__warning" tone="warning" role="status">{t("history.HistoryMessages.text_257f3b8b45")}</Notice> : null}
    </article>
  </li>)}</ol>;
}

function MessageText({ text, query }: { text: string; query: string }) {
  useTranslation();
  const parts = highlightedParts(text, query);
  const limit = 300;
  return <>{parts.slice(0, limit).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}
    {parts.slice(limit).map((part) => part.text).join("")}</>;
}
