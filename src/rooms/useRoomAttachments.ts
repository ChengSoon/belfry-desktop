import { t, useTranslation } from "../i18n";
import { discardRoomAttachment, importRoomAttachment, pickRoomAttachments } from "./attachmentApi";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "./attachments";
import type { RoomAttachment } from "./contracts";
import { useRoomDraft, type DraftAttachment } from "./drafts";
import { toAppFailure } from "../workspace/errors";

/** Imports and send completions belong to the room draft, including while its view is closed. */
export function useRoomAttachments(roomId: string) {
  useTranslation();
  const { draft, store } = useRoomDraft(roomId);
  const reportError = (error: string | null) => store.update({ error });
  const discard = (attachment: RoomAttachment) => {
    void discardRoomAttachment(roomId, attachment.id).catch((cause) => reportError(toAppFailure(cause).message));
  };
  const add = async (sources: (File | string)[]) => {
    if (store.disposed || sources.length === 0) return;
    reportError(null);
    const pending: { item: DraftAttachment; source: File | string }[] = [];
    const items = store.getSnapshot().items;
    const seen = new Set(items.map((entry) => entry.sourceKey));
    for (const source of sources) {
      const file = typeof source === "string" ? null : source;
      const name = typeof source === "string" ? source.split(/[\\/]/).pop() || t("rooms.useRoomAttachments.text_c7225dbf10") : source.name || t("rooms.useRoomAttachments.text_3a40d84b4b");
      const sourceKey = typeof source === "string" ? source : `${source.name}:${source.size}:${source.lastModified}`;
      if (seen.has(sourceKey)) continue;
      if (file && file.size > MAX_ATTACHMENT_BYTES) {
        reportError(t("rooms.useRoomAttachments.text_6fcfad1e65", { name: name }));
        continue;
      }
      if (items.length + pending.length >= MAX_ATTACHMENTS) {
        reportError(t("rooms.useRoomAttachments.text_a72a22e49b"));
        break;
      }
      seen.add(sourceKey);
      pending.push({ source, item: { key: crypto.randomUUID(), sourceKey, name, size: file?.size, attachment: null } });
    }
    store.update({ items: [...items, ...pending.map(({ item }) => item)] });
    // Transfer one file at a time; a view switch must not abandon the import or discard its result.
    for (const { item, source } of pending) {
      if (store.disposed || !store.getSnapshot().items.some((entry) => entry.key === item.key)) continue;
      try {
        const attachment = await importRoomAttachment(roomId, source);
        const current = store.getSnapshot().items;
        if (store.disposed || !current.some((entry) => entry.key === item.key)) { discard(attachment); continue; }
        store.update({ items: current.map((entry) => entry.key === item.key
          ? { ...entry, attachment, name: attachment.name, size: attachment.size } : entry) });
      } catch (cause) {
        store.update({ items: store.getSnapshot().items.filter((entry) => entry.key !== item.key),
          get error() { return t("rooms.useRoomAttachments.text_b125de1147", { name: item.name, message: toAppFailure(cause).message }); } });
      }
    }
  };
  const pick = async () => {
    if (store.disposed || store.getSnapshot().picking) return;
    store.update({ picking: true });
    try { await add(await pickRoomAttachments()); }
    catch (cause) { reportError(toAppFailure(cause).message); }
    finally { store.update({ picking: false }); }
  };
  const remove = (key: string) => {
    if (store.isSubmitted(key)) return;
    const items = store.getSnapshot().items;
    const item = items.find((entry) => entry.key === key);
    store.update({ items: items.filter((entry) => entry.key !== key) });
    if (item?.attachment) discard(item.attachment);
  };
  return { items: draft.items, error: draft.error, reportError, clearError: () => reportError(null), add, pick, remove,
    pending: draft.picking || draft.items.some((item) => !item.attachment),
    beginSend: store.beginSend, finishSend: store.finishSend };
}
