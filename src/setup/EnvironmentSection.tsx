import { useFeedback, localized, t, useTranslation } from "../i18n";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  LoaderCircle,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ICON } from "../theme/sizing";
import { SettingsHeader } from "../settings/SettingsHeader";
import { failureLabel, toAppFailure } from "../workspace/errors";
import { diagnoseEnvironment, installBelfrySkill } from "./api";
import {
  countChecks,
  summarizeSkillInstall,
  type CheckState,
  type EnvironmentReport,
} from "./contracts";
import { Notice } from "../components/Notice";
import "../settings/obsidianSections.css";
import "./environment.css";

type BusyAction = "diagnose" | "install" | null;

const OVERALL_LABEL: Record<CheckState, string> = localized(() => ({
  ok: t("setup.EnvironmentSection.text_c8958814a5"),
  warning: t("setup.EnvironmentSection.text_425d80b663"),
  error: t("setup.EnvironmentSection.text_dfa8130320"),
}));

export function EnvironmentSection() {
  useTranslation();
  const setup = useEnvironmentSetup();
  return (
    <section className="environment-section os-page">
      <EnvironmentHeader
        busy={setup.busy}
        onDiagnose={setup.diagnose}
        onInstall={setup.install}
      />
      <EnvironmentFeedback failure={setup.failure} notice={setup.notice} />
      <EnvironmentBody report={setup.report} />
    </section>
  );
}

function useEnvironmentSetup() {
  useTranslation();
  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [failure, setFailure] = useFeedback<string | null>(null);
  const [notice, setNotice] = useFeedback<string | null>(null);

  const diagnose = useCallback(async () => {
    setBusy("diagnose");
    setFailure(null);
    try {
      setReport(await diagnoseEnvironment());
    } catch (error) {
      setFailure(() => failureLabel(toAppFailure(error)));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void diagnose();
  }, [diagnose]);

  const install = useCallback(async () => {
    setBusy("install");
    setFailure(null);
    setNotice(null);
    try {
      const outcome = await installBelfrySkill();
      setFailure(() => summarizeSkillInstall(outcome).failure);
      setNotice(() => summarizeSkillInstall(outcome).notice);
      setReport(await diagnoseEnvironment());
    } catch (error) {
      setFailure(() => failureLabel(toAppFailure(error)));
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, diagnose, failure, install, notice, report };
}

interface HeaderProps {
  busy: BusyAction;
  onDiagnose: () => Promise<void>;
  onInstall: () => Promise<void>;
}

function EnvironmentHeader({ busy, onDiagnose, onInstall }: HeaderProps) {
  useTranslation();
  return (
    <SettingsHeader
      actions={<>
        <button
          aria-label={t("setup.EnvironmentSection.text_69611f40d2")}
          className="os-btn icon environment-action--icon"
          disabled={busy !== null}
          onClick={() => void onDiagnose()}
          title={t("setup.EnvironmentSection.text_69611f40d2")}
          type="button"
        >
          <RefreshCcw aria-hidden="true" className={busy === "diagnose" ? "environment-spin" : undefined} size={ICON.sm} />
        </button>
        <button className="os-btn primary environment-action--primary" disabled={busy !== null} onClick={() => void onInstall()} type="button">
          {busy === "install" ? <LoaderCircle aria-hidden="true" className="environment-spin" size={ICON.sm} />
            : <Download aria-hidden="true" size={ICON.sm} />}
          <span>{t("setup.EnvironmentSection.text_bfc960b0ec")}</span>
        </button>
      </>}
      description={t("setup.EnvironmentSection.description")}
      title={t("setup.EnvironmentSection.text_821f9ff1ad")}
    />
  );
}

function EnvironmentFeedback({ failure, notice }: { failure: string | null; notice: string | null }) {
  useTranslation();
  return (
    <>
      {notice ? <Notice className="environment-notice" tone="neutral" role="status">{notice}</Notice> : null}
      {failure ? <Notice className="environment-failure" role="alert">{failure}</Notice> : null}
    </>
  );
}

function EnvironmentBody({ report }: { report: EnvironmentReport | null }) {
  useTranslation();
  if (report) return <EnvironmentResults report={report} />;
  return (
    <div className="environment-loading" role="status">
      <LoaderCircle aria-hidden="true" className="environment-spin" size={ICON.md} />
      <span>{t("setup.EnvironmentSection.text_6b72c3d685")}</span>
    </div>
  );
}

function EnvironmentResults({ report }: { report: EnvironmentReport }) {
  useTranslation();
  const counts = countChecks(report);
  return (
    <>
      <div className="os-group">
        <div className="environment-summary" data-state={report.overall}>
          <span className="environment-summary__icon"><StatusIcon state={report.overall} /></span>
          <span className="environment-summary__body">
            <strong>{OVERALL_LABEL[report.overall]}</strong>
            <span>{t("setup.EnvironmentSection.text_e41906d038", { ok: counts.ok, warning: counts.warning, error: counts.error })}</span>
          </span>
        </div>
      </div>
      <section className="os-section">
        <div className="os-group-head"><h3>{t("setup.EnvironmentSection.checks")}</h3></div>
        <ul className="os-group environment-checks">
          {report.checks.map((check) => (
            <li data-state={check.state} key={check.id}>
              <span className="environment-checks__icon"><StatusIcon state={check.state} /></span>
              <span className="environment-checks__text">
                <strong>{check.label}</strong>
                <small>{check.summary}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function StatusIcon({ state }: { state: CheckState }) {
  useTranslation();
  if (state === "ok") return <CheckCircle2 aria-hidden="true" size={ICON.md} />;
  if (state === "warning") return <AlertTriangle aria-hidden="true" size={ICON.md} />;
  return <XCircle aria-hidden="true" size={ICON.md} />;
}
