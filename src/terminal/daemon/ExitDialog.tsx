import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ExitConfirmation } from "./ExitConfirmation";
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
  const choose = (choice: "confirm" | "cancel") => {
    if (busy) return;
    setBusy(true); setError(null);
    void invoke("terminal_exit", { choice }).then(() => { if (choice === "cancel") onClose(); })
      .catch((error) => setError(errorMessage(error))).finally(() => setBusy(false));
  };
  const ref = useDialog(() => choose("cancel"), busy);
  return createPortal(<div className="modal-scrim terminal-exit-backdrop">
    <ExitConfirmation dialogRef={ref} busy={busy} error={error}
      onCancel={() => choose("cancel")} onConfirm={() => choose("confirm")} />
  </div>, document.body);
}
