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

const OVERALL_LABEL: Record<CheckState, string> = {
  ok: "环境就绪",
  warning: "需要处理部分项目",
  error: "存在阻塞项",
};

export function EnvironmentSection() {
  const setup = useEnvironmentSetup();
  return (
    <section className="environment-section">
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
  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const diagnose = useCallback(async () => {
    setBusy("diagnose");
    setFailure(null);
    try {
      setReport(await diagnoseEnvironment());
    } catch (error) {
      setFailure(failureLabel(toAppFailure(error)));
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
      const feedback = summarizeSkillInstall(outcome);
      setFailure(feedback.failure);
      setNotice(feedback.notice);
      setReport(await diagnoseEnvironment());
    } catch (error) {
      setFailure(failureLabel(toAppFailure(error)));
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
  return (
    <header className="environment-section__header">
      <h2>协作环境</h2>
      <div className="environment-section__actions">
        <button
          className="environment-action environment-action--primary"
          disabled={busy !== null}
          onClick={() => void onInstall()}
          type="button"
        >
          {busy === "install" ? (
            <LoaderCircle aria-hidden="true" className="environment-spin" size={ICON.sm} />
          ) : <Download aria-hidden="true" size={ICON.sm} />}
          <span>同步全部 skill</span>
        </button>
        <button
          className="environment-action environment-action--icon"
          disabled={busy !== null}
          onClick={() => void onDiagnose()}
          title="重新检查协作环境"
          type="button"
        >
          <RefreshCcw
            aria-hidden="true"
            className={busy === "diagnose" ? "environment-spin" : undefined}
            size={ICON.sm}
          />
        </button>
      </div>
    </header>
  );
}

function EnvironmentFeedback({ failure, notice }: { failure: string | null; notice: string | null }) {
  return (
    <>
      {notice ? <p className="environment-notice" role="status">{notice}</p> : null}
      {failure ? <p className="environment-failure" role="alert">{failure}</p> : null}
    </>
  );
}

function EnvironmentBody({ report }: { report: EnvironmentReport | null }) {
  if (report) return <EnvironmentResults report={report} />;
  return (
    <div className="environment-loading" role="status">
      <LoaderCircle aria-hidden="true" className="environment-spin" size={ICON.md} />
      <span>正在检查…</span>
    </div>
  );
}

function EnvironmentResults({ report }: { report: EnvironmentReport }) {
  const counts = countChecks(report);
  return (
    <>
      <div className="environment-summary" data-state={report.overall}>
        <StatusIcon state={report.overall} />
        <strong>{OVERALL_LABEL[report.overall]}</strong>
        <span>{counts.ok} 正常 · {counts.warning} 警告 · {counts.error} 异常</span>
      </div>
      <ul className="environment-checks">
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
    </>
  );
}

function StatusIcon({ state }: { state: CheckState }) {
  if (state === "ok") return <CheckCircle2 aria-hidden="true" size={ICON.md} />;
  if (state === "warning") return <AlertTriangle aria-hidden="true" size={ICON.md} />;
  return <XCircle aria-hidden="true" size={ICON.md} />;
}
