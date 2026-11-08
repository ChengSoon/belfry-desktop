import { formatDateTime, useTranslation } from "../../i18n";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { historySize, type HistoryTimelineItem } from "../history";
import type { Room } from "../contracts";
import { labelOf, shortId } from "../model";
import { RoomMarkdown } from "./RoomMarkdown";
import { MessageAttachments } from "./RoomAttachments";

export function RoomInformation({ room, open, onClose }: { room: Room; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return <Dialog open={open} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto" data-room-information>
      <DialogHeader><DialogTitle>{t("rooms.history.information")}</DialogTitle><DialogDescription>{room.name}</DialogDescription></DialogHeader>
      <dl className="grid gap-2 text-sm"><dt>{t("rooms.history.size")}</dt><dd>{historySize(room.ledgerBytes)}</dd></dl>
      <p className="text-sm leading-relaxed">{t("rooms.history.retention")}</p>
    </DialogContent>
  </Dialog>;
}

export function RoomHistoryEntry({ item, room }: { item: HistoryTimelineItem; room: Room }) {
  const { t } = useTranslation();
  const record = item.record, event = record?.event;
  const message = item.kind === "message" ? item.message : null;
  const title = message ? t("rooms.history.message") : !event ? t("rooms.history.unreadable") : event.v !== 1
    ? t("rooms.history.version", { version: event.v }) : event.kind === "runtime.delivery" ? t("rooms.history.delivery")
      : event.kind === "chat.reply_request.cancelled" ? t("rooms.history.replyCancelled") : t("rooms.history.unknown", { kind: event.kind });
  const raw = record?.raw ?? (event ? JSON.stringify(event, null, 2) : "");
  return <article className="room-history-entry" data-history-record={record?.offset ?? item.key}>
    <header><span>{title}</span><span>{labelOf(room, message?.by ?? event?.by ?? "system")}</span>
      <time>{item.at ? formatDateTime(item.at, { dateStyle: "medium", timeStyle: "short" }) : t("rooms.history.unknownTime")}</time>
      {message ? <code>#{shortId(message.id)}</code> : null}</header>
    {record?.truncated ? <p role="note">{t("rooms.history.truncated")}</p> : null}
    {message ? <><RoomMarkdown text={message.text} projectRoot={room.projectRoot} /><MessageAttachments attachments={message.attachments} roomId={room.id} /></> : null}
    {raw ? <details open={!message && (!event || record?.truncated || !["runtime.delivery", "chat.reply_request.cancelled"].includes(event.kind))}>
      <summary>{t("rooms.history.raw")}</summary><pre>{raw}</pre>
    </details> : null}
  </article>;
}
