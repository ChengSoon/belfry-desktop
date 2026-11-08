import { useFeedback, t, useTranslation } from "../i18n";
import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { captureException, exportDiagnostics } from "./capture";
import "./diagnostics.css";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    void captureException(error, "react.boundary", info.componentStack ?? undefined);
  }
  render() { return this.state.failed ? <CrashPage /> : this.props.children; }
}

function CrashPage() {
  useTranslation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useFeedback("");
  const copy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const diagnostic = await exportDiagnostics();
      await navigator.clipboard.writeText(diagnostic.summary);
      setNotice(() => t("diagnostics.AppErrorBoundary.text_bc813d3e23"));
    } catch {
      setNotice(() => t("diagnostics.AppErrorBoundary.text_b2c0a5351d"));
    } finally { setBusy(false); }
  };
  const restart = async () => {
    if (busy) return;
    setBusy(true);
    try { await relaunch(); }
    catch { setNotice(() => t("diagnostics.AppErrorBoundary.text_9ad73d82ce")); }
    finally { setBusy(false); }
  };
  return <main className="app-crash" role="alert" aria-labelledby="app-crash-title">
    <div className="app-crash__card">
      <h1 id="app-crash-title">{t("diagnostics.AppErrorBoundary.text_59544b4a83")}</h1>
      <p>{t("diagnostics.AppErrorBoundary.text_0614781255")}</p>
      <div className="app-crash__actions">
        <button className="app-crash__copy" disabled={busy} onClick={() => void copy()} type="button">{t("diagnostics.AppErrorBoundary.text_045e09f57e")}</button>
        <button className="app-crash__restart" disabled={busy} onClick={() => void restart()} type="button">{t("diagnostics.AppErrorBoundary.text_d750ba6ab1")}</button>
      </div>
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  </main>;
}
