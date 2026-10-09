import type { RefObject } from "react";
import { Moon, X } from "lucide-react";

interface Props {
  dialogRef: RefObject<HTMLDivElement | null>;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ExitConfirmation({ dialogRef, busy, error, onConfirm, onCancel }: Props) {
  return <div className="modal terminal-exit" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="terminal-exit-title">
    <header><Moon size={22} aria-hidden="true" /><button className="icon-button" type="button" aria-label="取消退出" disabled={busy} onClick={onCancel}><X size={18} /></button></header>
    <h2 id="terminal-exit-title">退出 Belfry</h2>
    <p>确认退出？后台任务将继续运行，下次打开会自动恢复会话。</p>
    <div className="terminal-exit__choices">
      <button className="daemon-button" type="button" disabled={busy} onClick={onCancel}>取消</button>
      <button className="daemon-button daemon-button--primary" type="button" disabled={busy} onClick={onConfirm}>确认退出</button>
    </div>
    {error ? <p className="terminal-exit__error" role="alert">{error}</p> : null}
  </div>;
}
