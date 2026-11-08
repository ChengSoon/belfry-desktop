import { t, useTranslation } from "../../i18n";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useDialog } from "../../components/controls/useDialog";
import type { SshLaunch, SshTarget } from "../../terminal/contracts";
import { ICON } from "../../theme/sizing";
import { ConnectionFields, Credentials } from "../ssh/SshFields";
import { SshProfiles, SaveHost } from "../ssh/SshProfiles";
import { RemoteDirectory } from "../ssh/RemoteDirectory";
import { useSshForm } from "../ssh/useSshForm";
import "../sshDialog.css";
import "../ssh/sshHosts.css";

export { parseSshTarget } from "../ssh/target";

interface SshDialogProps {
  initialTarget?: SshTarget | null; initialRememberPassword?: boolean; mode?: "create" | "edit";
  onCancel: () => void; onConnect: (target: SshLaunch) => void;
}

export function SshDialog({ initialTarget, initialRememberPassword, mode = "create", onCancel, onConnect }: SshDialogProps) {
  useTranslation();
  const state = useSshForm(initialTarget, initialRememberPassword);
  const panelRef = useDialog(onCancel, state.clearing);
  const editing = mode === "edit";
  const target = { host: state.fields.host, user: state.fields.user || null, port: state.fields.port ? Number(state.fields.port) : null };
  return createPortal(<div className="modal-scrim ssh-dialog__scrim">
    <div ref={panelRef} className="modal modal--ssh modal--ssh-hosts" role="dialog" aria-modal="true" aria-labelledby="ssh-dialog-title">
      <header className="ssh-dialog__head"><div className="ssh-dialog__heading"><strong className="ssh-dialog__title" id="ssh-dialog-title">
        {editing ? t("workspace.SshDialog.text_c49d0350ec") : t("workspace.SshDialog.text_7f4405d077")}</strong>{editing ? <span>{t("workspace.SshDialog.text_6ba9aa8c6e")}</span> : null}</div>
        <button aria-label={t("workspace.SshDialog.text_55d144ad99")} className="icon-button icon-button--sm" onClick={onCancel} disabled={state.clearing} type="button">
          <X aria-hidden="true" size={ICON.md} /></button></header>
      <div className="ssh-hosts__body">
        <SshProfiles state={state} /><ConnectionFields state={state} />
        <RemoteDirectory key={JSON.stringify([state.fields.host, state.fields.user, state.fields.port])} target={target} path={state.fields.remotePath} onChange={(remotePath) => state.update({ remotePath })} />
        <Credentials state={state} /><SaveHost state={state} />
        <div className="ssh-hosts__feedback" aria-live="polite">
          {state.error ? <p className="ssh-form__error" role="alert">{state.error}</p> : null}
          {state.hosts.error ? <button type="button" className="ssh-link" onClick={state.hosts.reload}>{t("workspace.SshDialog.text_d155410a22")}</button> : null}
          {state.notice ? <p className="ssh-note" role="status">{state.notice}</p> : null}</div>
      </div>
      <div className="modal__actions ssh-dialog__actions"><button onClick={onCancel} disabled={state.clearing} type="button">{t("workspace.SshDialog.text_2cd0f3be87")}</button>
        <button className="modal__primary" disabled={state.clearing} type="button" onClick={() => { const target = state.parse(); if (target) onConnect(target); }}>
          {editing ? t("workspace.SshDialog.text_e26215c049") : t("workspace.SshDialog.text_a5574109f0")}</button></div>
    </div></div>, document.body);
}
