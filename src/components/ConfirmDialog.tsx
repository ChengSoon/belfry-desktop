import { useEffect, useRef } from "react";
import { useDismiss } from "../workspace/useDismiss";

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
 *
 * 不做焦点陷阱——和项目里其它浮层保持一致，退出手势统一交给 useDismiss
 * （Escape / 点框外）。初始聚焦本身已经把键盘从 xterm 手里接过来了。
 */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const panelRef = useDismiss<HTMLDivElement>(true, onCancel);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="modal-scrim">
      <div
        aria-describedby="confirm-body"
        aria-labelledby="confirm-title"
        aria-modal="true"
        className="modal"
        ref={panelRef}
        role="dialog"
      >
        <strong className="modal__title" id="confirm-title">{title}</strong>
        <p className="modal__body" id="confirm-body">{body}</p>
        <div className="modal__actions">
          <button onClick={onCancel} ref={cancelRef} type="button">取消</button>
          <button className="modal__danger" onClick={onConfirm} type="button">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
