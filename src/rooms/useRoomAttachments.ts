import { useEffect, useRef, useState } from "react";
import { discardRoomAttachment, importRoomAttachment, pickRoomAttachments } from "./attachmentApi";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "./attachments";
import type { RoomAttachment } from "./contracts";
import { toAppFailure } from "../workspace/errors";

export interface DraftAttachment {
  key: string;
  sourceKey: string;
  name: string;
  size?: number;
  attachment: RoomAttachment | null;
}

/** 由按 room.id 挂载的 Composer 持有；异步导入和发送都不能越过这次挂载。 */
export function useRoomAttachments(roomId: string) {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const entries = useRef<DraftAttachment[]>([]);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const choosing = useRef(false);

  const update = (next: DraftAttachment[]) => {
    entries.current = next;
    if (mounted.current) setItems(next);
  };
  const discard = (attachment: RoomAttachment) => {
    void discardRoomAttachment(roomId, attachment.id).catch((cause) => {
      if (mounted.current) setError(toAppFailure(cause).message);
    });
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // 发送已在途中时先保留文件，等成功或失败后再清理。
      if (!inFlight.current) {
        for (const item of entries.current) if (item.attachment) discard(item.attachment);
        entries.current = [];
      }
    };
  }, [roomId]);

  const add = async (sources: (File | string)[]) => {
    if (!mounted.current || inFlight.current || sources.length === 0) return;
    setError(null);
    const pending: { item: DraftAttachment; source: File | string }[] = [];
    const seen = new Set(entries.current.map((entry) => entry.sourceKey));
    for (const source of sources) {
      const path = typeof source === "string" ? source : null;
      const name = path !== null ? path.split(/[\\/]/).pop() || "附件" : (source as File).name || "粘贴附件";
      const file = typeof source === "string" ? null : source;
      const sourceKey = path ?? `${file!.name}:${file!.size}:${file!.lastModified}`;
      if (seen.has(sourceKey)) continue;
      if (file && file.size > MAX_ATTACHMENT_BYTES) {
        setError(`「${name}」超过 20 MB，请选择较小的文件。`);
        continue;
      }
      if (entries.current.length + pending.length >= MAX_ATTACHMENTS) {
        setError("每条消息最多添加 10 个附件，超出的文件未添加。");
        break;
      }
      seen.add(sourceKey);
      pending.push({ source, item: { key: crypto.randomUUID(), sourceKey, name, size: file?.size, attachment: null } });
    }
    update([...entries.current, ...pending.map(({ item }) => item)]);
    // 逐个传送二进制，避免多张大图同时在 IPC 中占用内存。
    for (const { item, source } of pending) {
      if (!mounted.current || !entries.current.some((entry) => entry.key === item.key)) continue;
      try {
        const attachment = await importRoomAttachment(roomId, source);
        if (!mounted.current || !entries.current.some((entry) => entry.key === item.key)) {
          discard(attachment);
          continue;
        }
        update(entries.current.map((entry) => entry.key === item.key
          ? { ...entry, attachment, name: attachment.name, size: attachment.size } : entry));
      } catch (cause) {
        update(entries.current.filter((entry) => entry.key !== item.key));
        if (mounted.current) setError(`「${item.name}」添加失败：${toAppFailure(cause).message}`);
      }
    }
  };

  const pick = async () => {
    if (choosing.current || inFlight.current) return;
    choosing.current = true;
    setPicking(true);
    try { await add(await pickRoomAttachments()); }
    catch (cause) { if (mounted.current) setError(toAppFailure(cause).message); }
    finally {
      choosing.current = false;
      if (mounted.current) setPicking(false);
    }
  };

  const remove = (key: string) => {
    if (inFlight.current) return;
    const item = entries.current.find((entry) => entry.key === key);
    update(entries.current.filter((entry) => entry.key !== key));
    if (item?.attachment) discard(item.attachment);
  };

  const beginSend = () => {
    if (inFlight.current || choosing.current || entries.current.some((entry) => !entry.attachment)) return null;
    inFlight.current = true;
    return entries.current.map((entry) => entry.attachment!.id);
  };

  const finishSend = (success: boolean) => {
    inFlight.current = false;
    if (success) { update([]); if (mounted.current) setError(null); }
    else if (!mounted.current) {
      for (const item of entries.current) if (item.attachment) discard(item.attachment);
      entries.current = [];
    }
  };

  return { items, error, reportError: setError, clearError: () => setError(null), add, pick, remove,
    pending: picking || items.some((item) => !item.attachment), beginSend, finishSend };
}
