import { FileText, FolderOpen, Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "../../components/controls/useDialog";
import { ICON } from "../../theme/sizing";
import { toAppFailure } from "../../workspace/errors";
import { readRoomAttachment, revealRoomAttachment } from "../attachmentApi";
import { attachmentSize, isPreviewImage } from "../attachments";
import type { RoomAttachment } from "../contracts";

export function RoomAttachments({ roomId, attachments }: { roomId: string; attachments?: RoomAttachment[] }) {
  if (!attachments?.length) return null;
  return <div aria-label="消息附件" className="room-attachments room-attachments--message">
    {attachments.map((attachment) => <RoomAttachmentCard attachment={attachment} key={attachment.id} roomId={roomId} />)}
  </div>;
}

export function RoomAttachmentCard({ roomId, attachment, name, size, onRemove, disabled = false }: {
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
      } catch { if (active) setError("预览不可用，可在文件夹中查看"); }
    };
    // 只读取可见附件；翻聊天记录时才加载历史图片。
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
  return <div className={`room-attachment${image ? " room-attachment--image" : ""}`} ref={host}>
    <button className="room-attachment__open" disabled={!attachment || (image && !url && !error)}
      onClick={() => image && url ? setPreview(true) : void reveal()}
      title={image && !error ? `预览 ${label}` : `在文件夹中显示 ${label}`} type="button">
      <span className="room-attachment__icon">
        {!attachment ? <LoaderCircle aria-hidden="true" className="room-send__spin" size={ICON.md} />
          : url ? <img alt="" src={url} onError={() => { setUrl(null); setError("预览不可用，可在文件夹中查看"); }} />
            : image ? <ImageIcon aria-hidden="true" size={ICON.md} /> : <FileText aria-hidden="true" size={ICON.md} />}
      </span>
      <span className="room-attachment__info">
        <strong>{label}</strong>
        <small title={error ?? undefined}>{error ?? (!attachment ? "正在添加…" : bytes === undefined ? "文件" : attachmentSize(bytes))}</small>
      </span>
    </button>
    {onRemove ? <button aria-label={`移除附件 ${label}`} className="room-attachment__action" disabled={disabled}
      onClick={onRemove} title="移除附件" type="button"><X aria-hidden="true" size={ICON.xs} /></button>
      : <button aria-label={`在文件夹中显示 ${label}`} className="room-attachment__action" onClick={() => void reveal()}
        title="在文件夹中显示" type="button"><FolderOpen aria-hidden="true" size={ICON.sm} /></button>}
    {preview && url ? <ImagePreview name={label} onClose={() => setPreview(false)} onReveal={() => void reveal()} url={url} /> : null}
  </div>;
}

function ImagePreview({ name, url, onClose, onReveal }: { name: string; url: string; onClose: () => void; onReveal: () => void }) {
  const ref = useDialog(onClose);
  return createPortal(<div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div aria-label={`图片预览 ${name}`} aria-modal="true" className="modal room-image-preview" ref={ref} role="dialog">
      <header><strong>{name}</strong>
        <button aria-label="在文件夹中显示" onClick={onReveal} title="在文件夹中显示" type="button"><FolderOpen aria-hidden="true" size={ICON.md} /></button>
        <button aria-label="关闭图片预览" onClick={onClose} title="关闭图片预览" type="button"><X aria-hidden="true" size={ICON.md} /></button>
      </header>
      <img alt={name} src={url} />
    </div>
  </div>, document.body);
}
