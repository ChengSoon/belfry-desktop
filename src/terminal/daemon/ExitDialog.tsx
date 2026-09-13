import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Moon, X } from "lucide-react";
import { useDialog } from "../../components/controls/useDialog";
import { errorMessage } from "../terminalController";
import "./daemon.css";

export function TerminalExitDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("terminal-exit-requested", () => setOpen(true)).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
      return invoke<boolean>("terminal_exit_pending");
    }).then((pending) => { if (!disposed && pending) setOpen(true); }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, []);
  return open ? <ExitChoice onClose={() => setOpen(false)} /> : null;
}

function ExitChoice({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = (choice: "retain" | "terminate" | "cancel") => {
    if (busy) return;
    setBusy(true); setError(null);
    void invoke("terminal_exit", { choice }).then(() => { if (choice === "cancel") onClose(); })
      .catch((error) => setError(errorMessage(error))).finally(() => setBusy(false));
  };
  const ref = useDialog(() => choose("cancel"), busy);
  return createPortal(<div className="modal-scrim terminal-exit-backdrop">
    <div className="modal terminal-exit" ref={ref} role="dialog" aria-modal="true" aria-labelledby="terminal-exit-title">
      <header><Moon size={22} aria-hidden="true" /><button className="icon-button" type="button" aria-label="取消退出" disabled={busy} onClick={() => choose("cancel")}><X size={18} /></button></header>
      <h2 id="terminal-exit-title">退出 Belfry</h2>
      <p>任务可以在后台继续。重新打开应用后，会连接原来的终端并恢复输出。</p>
      <div className="terminal-exit__choices">
        <button className="daemon-button daemon-button--primary" type="button" disabled={busy} onClick={() => choose("retain")}>保留任务并退出</button>
        <button className="daemon-button" type="button" disabled={busy} onClick={() => choose("terminate")}>结束任务并退出</button>
      </div>
      {error ? <p className="terminal-exit__error" role="alert">{error}</p> : null}
      <button className="terminal-exit__cancel" type="button" disabled={busy} onClick={() => choose("cancel")}>继续使用</button>
    </div>
  </div>, document.body);
}
