import { t, useTranslation } from "../../i18n";
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
  useTranslation();
  return <div className="modal terminal-exit" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="terminal-exit-title">
    <header><Moon size={22} aria-hidden="true" /><button className="icon-button" type="button" aria-label={t("terminal.ExitConfirmation.text_1cf5f937fd")} disabled={busy} onClick={onCancel}><X size={18} /></button></header>
    <h2 id="terminal-exit-title">{t("terminal.ExitConfirmation.text_9be2c450d3")}</h2>
    <p>{t("terminal.ExitConfirmation.text_8f9323cc5a")}</p>
    <div className="terminal-exit__choices">
      <button className="daemon-button" type="button" disabled={busy} onClick={onCancel}>{t("terminal.ExitConfirmation.text_2cd0f3be87")}</button>
      <button className="daemon-button daemon-button--primary" type="button" disabled={busy} onClick={onConfirm}>{t("terminal.ExitConfirmation.text_ab942a2cac")}</button>
    </div>
    {error ? <p className="terminal-exit__error" role="alert">{error}</p> : null}
  </div>;
}
