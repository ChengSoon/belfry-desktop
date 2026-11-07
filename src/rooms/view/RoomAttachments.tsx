import { FileText, FolderOpen, Image as ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Spinner } from "../../components/ui/spinner";
import { cn } from "../../lib/utils";
import { toAppFailure } from "../../workspace/errors";
import { readRoomAttachment, revealRoomAttachment } from "../attachmentApi";
import { attachmentExtension, attachmentSize, isPreviewImage } from "../attachments";
import type { RoomAttachment } from "../contracts";

/** 消息里的附件：图片排成缩略图，文档排成文件卡片。 */
export function MessageAttachments({ roomId, attachments }: { roomId: string; attachments?: RoomAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <div aria-label="消息附件" className="mt-1.5 flex flex-wrap gap-2">
      {attachments.map((attachment) => <AttachmentCard attachment={attachment} key={attachment.id} roomId={roomId} />)}
    </div>
  );
}

/**
 * 一张附件卡片。`attachment` 为 null 表示还在导入（复制成房间副本）。
 *
 * 图片只在滚进视野时才读出来预览：翻历史记录时不一次把所有图读进内存。
 */
export function AttachmentCard({ roomId, attachment, name, size, onRemove, disabled = false }: {
  roomId: string;
  attachment: RoomAttachment | null;
  name?: string;
  size?: number;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const image = attachment ? isPreviewImage(attachment.mimeType) : false;
  const label = attachment?.name ?? name ?? "附件";
  const bytes = attachment?.size ?? size;
  const extension = attachmentExtension(label);

  useEffect(() => {
    if (!attachment || !image) return;
    let active = true, loaded = false, objectUrl: string | null = null;
    setUrl(null);
    const read = async () => {
      if (loaded) return;
      loaded = true;
      try {
        const data = await readRoomAttachment(roomId, attachment.id);
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([data], { type: attachment.mimeType }));
        setUrl(objectUrl);
      } catch { if (active) setError("预览不可用"); }
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { void read(); observer.disconnect(); }
    }, { rootMargin: "120px" });
    if (host.current) observer.observe(host.current);
    return () => { active = false; observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [roomId, attachment?.id, attachment?.mimeType, image]);

  const reveal = async () => {
    if (!attachment) return;
    try { await revealRoomAttachment(roomId, attachment.id); }
    catch (cause) { setError(toAppFailure(cause).message); }
  };
  const open = () => { if (image && url) setPreview(true); else void reveal(); };
  const detail = error ?? (!attachment ? "正在添加…" : bytes === undefined ? "文件" : attachmentSize(bytes));

  return (
    <div className="group/attachment relative" ref={host}>
      {image && url ? (
        <button aria-label={`预览 ${label}`} className="block overflow-hidden rounded-lg border border-border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={open} title={label} type="button">
          <img alt={label} className="h-28 max-w-56 object-cover" onError={() => { setUrl(null); setError("预览不可用"); }} src={url} />
        </button>
      ) : (
        <button className={cn(
          "flex h-12 w-56 items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 text-left transition-colors outline-none",
          "hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-card",
        )} disabled={!attachment} onClick={open} title={image ? `预览 ${label}` : `在文件夹中显示 ${label}`} type="button">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {!attachment ? <Spinner /> : image ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{label}</span>
            <span className={cn("block truncate text-[11px] text-muted-foreground", error && "text-destructive")}>
              {extension && attachment ? `${extension} · ` : ""}{detail}
            </span>
          </span>
        </button>
      )}
      {onRemove ? (
        <Button aria-label={`移除附件 ${label}`} disabled={disabled} onClick={onRemove} size="icon-xs" variant="secondary"
          className="absolute -top-1.5 -right-1.5 size-5 rounded-full border border-border opacity-0 shadow-sm group-hover/attachment:opacity-100 focus-visible:opacity-100">
          <X className="size-3" />
        </Button>
      ) : attachment && !image ? null : attachment ? (
        <Button aria-label={`在文件夹中显示 ${label}`} onClick={() => void reveal()} size="icon-xs" variant="secondary"
          className="absolute top-1 right-1 opacity-0 shadow-sm group-hover/attachment:opacity-100 focus-visible:opacity-100">
          <FolderOpen />
        </Button>
      ) : null}
      {preview && url ? (
        <Dialog onOpenChange={setPreview} open>
          <DialogContent className="max-h-[90vh] gap-3 sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="truncate pr-8">{label}</DialogTitle>
              <DialogDescription>{bytes !== undefined ? attachmentSize(bytes) : null}</DialogDescription>
            </DialogHeader>
            <img alt={label} className="max-h-[70vh] w-full rounded-md object-contain" src={url} />
            <div className="flex justify-end">
              <Button onClick={() => void reveal()} size="sm" variant="outline"><FolderOpen /> 在文件夹中显示</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
