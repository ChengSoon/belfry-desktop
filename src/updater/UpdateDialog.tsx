import { t, useTranslation } from "../i18n";
import { AlertTriangle, Check, Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { ICON } from "../theme/sizing";
import { useDismiss } from "../workspace/useDismiss";
import type { UpdaterState } from "./contracts";
import { formatBytes } from "./progress";
import "./updater.css";

interface UpdateDialogProps {
  state: UpdaterState;
  onCheck: () => void;
  onInstall: () => void;
  onClose: () => void;
}

export function UpdateDialog({ state, onCheck, onInstall, onClose }: UpdateDialogProps) {
  useTranslation();
  const busy = state.status === "downloading" || state.status === "installing";
  const panelRef = useDismiss<HTMLDivElement>(!busy, onClose);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!busy) closeRef.current?.focus();
  }, [busy]);

  return (
    <div className="modal-scrim">
      <div
        aria-labelledby="updater-title"
        aria-modal="true"
        className="modal modal--updater"
        ref={panelRef}
        role="dialog"
      >
        <header className="updater-dialog__head">
          <span className={`updater-dialog__mark updater-dialog__mark--${state.status}`}>
            <StatusIcon status={state.status} />
          </span>
          <div>
            <strong className="modal__title" id="updater-title">{t("updater.UpdateDialog.text_943cc79488")}</strong>
            <p>{versionLine(state)}</p>
          </div>
        </header>

        <div className="updater-dialog__body" aria-live="polite" aria-atomic="true"><UpdateContent state={state} /></div>
        <DialogActions
          closeRef={closeRef}
          onCheck={onCheck}
          onClose={onClose}
          onInstall={onInstall}
          state={state}
        />
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: UpdaterState["status"] }) {
  useTranslation();
  if (status === "checking" || status === "downloading" || status === "installing") {
    return <LoaderCircle aria-hidden="true" className="updater-spin" size={ICON.lg} />;
  }
  if (status === "current") return <Check aria-hidden="true" size={ICON.lg} />;
  if (status === "error") return <AlertTriangle aria-hidden="true" size={ICON.lg} />;
  return <Download aria-hidden="true" size={ICON.lg} />;
}

function UpdateContent({ state }: { state: UpdaterState }) {
  useTranslation();
  if (state.status === "checking") return <p className="updater-dialog__message">{t("updater.UpdateDialog.text_ecc48ab0e2")}</p>;
  if (state.status === "current") return <p className="updater-dialog__message">{t("updater.UpdateDialog.text_ca9955f4ec")}</p>;
  if (state.status === "error") {
    return <p className="updater-dialog__message updater-dialog__message--error" role="alert">{state.error}<small>{t("updater.UpdateDialog.text_b9e759ac81")}</small></p>;
  }
  if (state.status === "downloading" || state.status === "installing") {
    return <DownloadProgress state={state} />;
  }
  if (state.status === "available") {
    return (
      <div className="updater-dialog__release">
        <span>{t("updater.UpdateDialog.text_a596c619e4")}</span>
        <p>{state.notes ?? t("updater.UpdateDialog.text_56440966fd")}</p>
      </div>
    );
  }
  return <p className="updater-dialog__message">{t("updater.UpdateDialog.text_7c1118df14")}</p>;
}

function DownloadProgress({ state }: { state: UpdaterState }) {
  useTranslation();
  const installing = state.status === "installing";
  const label = installing ? t("updater.UpdateDialog.text_5e069b0d8c") : downloadLabel(state);
  return (
    <div className="updater-dialog__download">
      <div className="updater-dialog__progress-label">
        <span>{label}</span>
        {state.progress === null ? null : <i>{Math.round(state.progress)}%</i>}
      </div>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={state.progress ?? undefined}
        className={`updater-dialog__progress${state.progress === null ? " is-indeterminate" : ""}`}
        role="progressbar"
      >
        <i style={{ width: `${state.progress ?? 36}%` }} />
      </div>
    </div>
  );
}

function DialogActions({
  state,
  onCheck,
  onInstall,
  onClose,
  closeRef,
}: UpdateDialogProps & { closeRef: RefObject<HTMLButtonElement | null> }) {
  useTranslation();
  const busy = state.status === "downloading" || state.status === "installing";
  return (
    <div className="modal__actions">
      {busy ? null : (
        <button onClick={onClose} ref={closeRef} type="button">
          {state.status === "available" ? t("updater.UpdateDialog.text_9d2ca26128") : t("updater.UpdateDialog.text_3fd47edce4")}
        </button>
      )}
      {state.status === "available" ? (
        <button className="modal__primary" onClick={onInstall} type="button">{t("updater.UpdateDialog.text_ac69f68b70")}</button>
      ) : busy ? (
        <button className="modal__primary" disabled type="button">{t("updater.UpdateDialog.text_2336147a7f")}</button>
      ) : (
        <button className="modal__primary" disabled={state.status === "checking"} onClick={onCheck} type="button">
          {state.status === "checking" ? t("updater.UpdateDialog.text_d85ff08f91") : t("updater.UpdateDialog.text_fe0503e4a3")}
        </button>
      )}
    </div>
  );
}

function versionLine(state: UpdaterState) {
  if (state.availableVersion) return `v${state.currentVersion} → v${state.availableVersion}`;
  return t("updater.UpdateDialog.text_937ee9309c", { currentVersion: state.currentVersion });
}

function downloadLabel(state: UpdaterState) {
  if (state.totalBytes) {
    return `${formatBytes(state.downloadedBytes)} / ${formatBytes(state.totalBytes)}`;
  }
  return state.downloadedBytes ? t("updater.UpdateDialog.text_5d42786bd4", { bytes: formatBytes(state.downloadedBytes) }) : t("updater.UpdateDialog.text_b7bc6d20fa");
}
