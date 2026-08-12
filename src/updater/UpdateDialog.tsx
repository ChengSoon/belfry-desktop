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
            <strong className="modal__title" id="updater-title">Belfry 更新</strong>
            <p>{versionLine(state)}</p>
          </div>
        </header>

        <UpdateContent state={state} />
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
  if (status === "checking" || status === "downloading" || status === "installing") {
    return <LoaderCircle aria-hidden="true" className="updater-spin" size={ICON.lg} />;
  }
  if (status === "current") return <Check aria-hidden="true" size={ICON.lg} />;
  if (status === "error") return <AlertTriangle aria-hidden="true" size={ICON.lg} />;
  return <Download aria-hidden="true" size={ICON.lg} />;
}

function UpdateContent({ state }: { state: UpdaterState }) {
  if (state.status === "checking") return <p className="updater-dialog__message">正在连接更新服务器…</p>;
  if (state.status === "current") return <p className="updater-dialog__message">当前已是最新版本。</p>;
  if (state.status === "error") {
    return <p className="updater-dialog__message updater-dialog__message--error">{state.error}</p>;
  }
  if (state.status === "downloading" || state.status === "installing") {
    return <DownloadProgress state={state} />;
  }
  if (state.status === "available") {
    return (
      <div className="updater-dialog__release">
        <span>版本说明</span>
        <p>{state.notes ?? "此版本包含体验优化和问题修复。"}</p>
      </div>
    );
  }
  return <p className="updater-dialog__message">准备检查更新。</p>;
}

function DownloadProgress({ state }: { state: UpdaterState }) {
  const installing = state.status === "installing";
  const label = installing ? "正在安装，完成后将自动重启" : downloadLabel(state);
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
  const busy = state.status === "downloading" || state.status === "installing";
  return (
    <div className="modal__actions">
      {busy ? null : (
        <button onClick={onClose} ref={closeRef} type="button">
          {state.status === "available" ? "稍后" : "关闭"}
        </button>
      )}
      {state.status === "available" ? (
        <button className="modal__primary" onClick={onInstall} type="button">下载并安装</button>
      ) : busy ? (
        <button className="modal__primary" disabled type="button">正在更新</button>
      ) : (
        <button className="modal__primary" disabled={state.status === "checking"} onClick={onCheck} type="button">
          {state.status === "checking" ? "正在检查" : "再次检查"}
        </button>
      )}
    </div>
  );
}

function versionLine(state: UpdaterState) {
  if (state.availableVersion) return `v${state.currentVersion} → v${state.availableVersion}`;
  return `当前版本 v${state.currentVersion}`;
}

function downloadLabel(state: UpdaterState) {
  if (state.totalBytes) {
    return `${formatBytes(state.downloadedBytes)} / ${formatBytes(state.totalBytes)}`;
  }
  return state.downloadedBytes ? `已下载 ${formatBytes(state.downloadedBytes)}` : "正在准备下载";
}
