import { useId } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "./controls/useDialog";

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 危险操作的确认框。默认焦点压在取消上：这个框只在"按下去会丢东西"时出现，
 * 顺手一个回车不该正好是那一下。
 */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const panelRef = useDialog(onCancel);
  const id = useId();
  const content = (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div
        aria-describedby={`${id}-body`}
        aria-labelledby={`${id}-title`}
        aria-modal="true"
        className="modal"
        ref={panelRef}
        role="dialog"
      >
        <strong className="modal__title" id={`${id}-title`}>{title}</strong>
        <p className="modal__body" id={`${id}-body`}>{body}</p>
        <div className="modal__actions">
          <button onClick={onCancel} type="button">取消</button>
          <button className="modal__danger" onClick={onConfirm} type="button">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}
