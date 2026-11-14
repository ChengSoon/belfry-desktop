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
import { SButton, SGroupTitle, SList, STag } from "../settings/kit";
import { failureLabel, toAppFailure } from "../workspace/errors";
import { diagnoseEnvironment, installBelfrySkill } from "./api";
import {
  countChecks,
  summarizeSkillInstall,
  type CheckState,
  type EnvironmentReport,
} from "./contracts";
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
  // 稿（settings-v3/settings.html?page=env，T42）：顶部状态卡（总状态 + 重新检查 + 同步全部 skill）→「检查项」列表。
  return (
    <div className="environment-section">
      <EnvironmentHero busy={setup.busy} report={setup.report} onDiagnose={setup.diagnose} onInstall={setup.install} />
      <EnvironmentFeedback failure={setup.failure} notice={setup.notice} />
      <EnvironmentChecks report={setup.report} />
    </div>
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

interface HeroProps {
  busy: BusyAction;
  report: EnvironmentReport | null;
  onDiagnose: () => Promise<void>;
  onInstall: () => Promise<void>;
}

function EnvironmentHero({ busy, report, onDiagnose, onInstall }: HeroProps) {
  useTranslation();
  const counts = report ? countChecks(report) : null;
  const title = report ? OVERALL_LABEL[report.overall] : t("setup.EnvironmentSection.text_6b72c3d685");
  const sub = counts ? t("setup.EnvironmentSection.text_e41906d038", { ok: counts.ok, warning: counts.warning, error: counts.error }) : t("setup.EnvironmentSection.description");
  return (
    <SList>
      <div className="sk-hero environment-summary" data-state={report?.overall ?? "loading"}>
        <span className={`sk-hero-badge${report?.overall === "ok" ? " is-ok" : report?.overall === "error" ? " is-danger" : ""}`}>
          {report ? <StatusIcon state={report.overall} /> : <LoaderCircle aria-hidden="true" className="environment-spin" size={ICON.md} />}
        </span>
        <div><b>{title}</b><span className="sk-hero-sub">{sub}</span></div>
        <div className="sk-r">
          <SButton aria-label={t("setup.EnvironmentSection.text_69611f40d2")} className="environment-action--icon" disabled={busy !== null} onClick={() => void onDiagnose()} title={t("setup.EnvironmentSection.text_69611f40d2")}>
            <RefreshCcw aria-hidden="true" className={busy === "diagnose" ? "environment-spin" : undefined} size={ICON.sm} />{t("setup.EnvironmentSection.recheck")}
          </SButton>
          <SButton className="environment-action--primary" disabled={busy !== null} onClick={() => void onInstall()} tone="primary">
            {busy === "install" ? <LoaderCircle aria-hidden="true" className="environment-spin" size={ICON.sm} /> : <Download aria-hidden="true" size={ICON.sm} />}
            <span>{t("setup.EnvironmentSection.text_bfc960b0ec")}</span>
          </SButton>
        </div>
      </div>
    </SList>
  );
}

function EnvironmentFeedback({ failure, notice }: { failure: string | null; notice: string | null }) {
  useTranslation();
  return (
    <>
      {notice ? <p className="sk-note environment-notice" role="status">{notice}</p> : null}
      {failure ? <p className="sk-note is-danger environment-failure" role="alert">{failure}</p> : null}
    </>
  );
}

function EnvironmentChecks({ report }: { report: EnvironmentReport | null }) {
  useTranslation();
  if (!report) return null;
  return (
    <>
      <SGroupTitle>{t("setup.EnvironmentSection.checks")}</SGroupTitle>
      <SList>
        <ul className="environment-checks">
          {report.checks.map((check) => (
            <li className="sk-item" data-state={check.state} key={check.id}>
              <span className={`sk-dot${check.state === "ok" ? "" : " is-warn"}`} aria-hidden="true" />
              <div className="sk-l"><b>{check.label}</b><span>{check.summary}</span></div>
              <div className="sk-r">{check.state === "ok"
                ? <STag tone="ok" dot>{t("setup.EnvironmentSection.stateOk")}</STag>
                : <STag tone={check.state === "error" ? "danger" : "warn"} dot>{check.state === "error" ? t("setup.EnvironmentSection.stateError") : t("setup.EnvironmentSection.stateWarning")}</STag>}</div>
            </li>
          ))}
        </ul>
      </SList>
    </>
  );
}

function StatusIcon({ state }: { state: CheckState }) {
  useTranslation();
  if (state === "ok") return <CheckCircle2 aria-hidden="true" size={ICON.md} />;
  if (state === "warning") return <AlertTriangle aria-hidden="true" size={ICON.md} />;
  return <XCircle aria-hidden="true" size={ICON.md} />;
}
