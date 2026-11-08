import { useFeedback, formatList } from "../../i18n";
import { getLocale, t, useTranslation } from "../../i18n";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { messageSummary } from "../attachments";
import type { Room, RoomMessage } from "../contracts";
import { allRoomMessages, awaitingReply, excerpt, findRoomMessage, labelOf, shortId } from "../model";
import { MessageAttachments } from "./RoomAttachments";
import { RoomMarkdown } from "./RoomMarkdown";

/** A separate inbox includes retained requests without extending the recent chat timeline. */
export function RoomReplyInbox({ room, onReply }: { room: Room; onReply: (message: RoomMessage) => void }) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [error, setError] = useFeedback("");
  const [preview, setPreview] = useState<RoomMessage | null>(null);
  const pending = useMemo(() => allRoomMessages(room).filter((message) => awaitingReply(message).length > 0), [room.messages, room.retainedMessages, getLocale()]);
  const reply = (message: RoomMessage) => { onReply(message); setOpen(false); setPreview(null); setError(""); };
  return <>
    <Button className="ml-auto" aria-label={t("rooms.RoomReplyInbox.text_0a7a250f8c")} onClick={() => setOpen(true)} size="xs" variant="ghost">
      {pending.length ? t("rooms.RoomReplyInbox.text_d4f0c5f75d", { count: pending.length }) : t("rooms.RoomReplyInbox.text_6975d187ce")}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("rooms.RoomReplyInbox.text_494f8cf413")}</DialogTitle><DialogDescription>{t("rooms.RoomReplyInbox.text_4a3258c034")}</DialogDescription></DialogHeader>
        <form className="flex gap-2" onSubmit={(event) => {
          event.preventDefault();
          const message = findRoomMessage(room, reference.trim().replace(/^#/, ""));
          if (message) reply(message); else setError(() => t("rooms.RoomReplyInbox.text_4a58a72c54"));
        }}>
          <Input aria-label={t("rooms.RoomReplyInbox.text_3cbcf4b644")} placeholder={t("rooms.RoomReplyInbox.text_affb20aa14")} value={reference} onChange={(event) => setReference(event.target.value)} />
          <Button type="submit" variant="outline">{t("rooms.RoomReplyInbox.text_6975d187ce")}</Button>
        </form>
        {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        <div className="flex flex-col gap-2" aria-label={t("rooms.RoomReplyInbox.text_c521eedac3")}>
          {pending.map((message) => <article className="rounded-md border border-border p-3" key={message.id} data-pending-message={message.id}>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{labelOf(room, message.by)}</span><code>#{shortId(message.id)}</code></div>
            <p className="my-2 break-words text-sm">{excerpt(messageSummary(message), 160)}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="mr-auto text-muted-foreground">{t("rooms.reply.awaiting", { names: formatList(awaitingReply(message).map((id) => labelOf(room, id))) })}</span>
              <Button onClick={() => setPreview(message)} size="xs" variant="ghost">{t("rooms.RoomReplyInbox.text_e8952ea03f")}</Button>
              <Button onClick={() => reply(message)} size="xs" variant="outline">{t("rooms.RoomReplyInbox.text_cf945e21dd")}</Button>
            </div>
          </article>)}
          {!pending.length ? <p className="text-sm text-muted-foreground">{t("rooms.RoomReplyInbox.text_392a0be96d")}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
    <RoomMessagePreview message={preview} room={room} onClose={() => setPreview(null)} onReply={reply} />
  </>;
}

export function RoomMessagePreview({ message, room, onClose, onReply }: {
  message: RoomMessage | null; room: Room; onClose: () => void; onReply: (message: RoomMessage) => void;
}) {
  useTranslation();
  return <Dialog open={message !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    {message ? <DialogContent className="max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{t("rooms.RoomReplyInbox.text_1c5523a6df")}</DialogTitle><DialogDescription>{labelOf(room, message.by)} · #{shortId(message.id)}</DialogDescription></DialogHeader>
      <RoomMarkdown text={message.text} projectRoot={room.projectRoot} />
      <MessageAttachments attachments={message.attachments} roomId={room.id} />
      <div className="flex justify-end"><Button onClick={() => { onReply(message); onClose(); }}>{t("rooms.RoomReplyInbox.text_b83bb87b04")}</Button></div>
    </DialogContent> : null}
  </Dialog>;
}
