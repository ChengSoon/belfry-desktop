import { createContext, useContext, useMemo, type ReactNode } from "react";
import { t, useTranslation } from "../i18n";
import type { ProtocolTaskPreview, TaskRef } from "./contracts";
import { a2aErrorMessage } from "./feedback";
import { protocolStateLabel, protocolStateTone, taskReportFor, taskReportIndex } from "./taskReportModel";
import { useTaskReports } from "./useTaskReports";
import "./taskReports.css";

const TaskReports = createContext<{ index: ReadonlyMap<string, ProtocolTaskPreview>; error: unknown }>({ index: new Map(), error: null });

export function TaskReportsProvider({ rootPath, children }: { rootPath: string | null; children: ReactNode }) {
  const snapshot = useTaskReports(rootPath);
  const value = useMemo(() => ({ index: taskReportIndex(snapshot.tasks), error: snapshot.error }), [snapshot.tasks, snapshot.error]);
  return <TaskReports.Provider value={value}>{children}</TaskReports.Provider>;
}

export function TaskReportsFailure() {
  useTranslation();
  const { error } = useContext(TaskReports);
  return error ? <p className="a2a-report-error" role="alert">{t("a2a.reports.refreshFailed")} {a2aErrorMessage(error)}</p> : null;
}

export function TaskReport({ reference }: { reference: TaskRef | null | undefined }) {
  const { index } = useContext(TaskReports);
  const report = taskReportFor(index, reference);
  return report ? <TaskReportPreview report={report} /> : null;
}

export function TaskReportPreview({ report }: { report: ProtocolTaskPreview }) {
  useTranslation();
  const needsInput = ["TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED", "TASK_STATE_FAILED"].includes(report.state);
  return <section className="a2a-task-report" aria-label={t("a2a.reports.title")}
    data-protocol-state={report.state} data-task-id={report.taskRef.id} data-task-generation={report.taskRef.generation}>
    <p className="a2a-task-report__status">
      <span className="a2a-task-report__source">{t("a2a.reports.source")}</span>
      <strong className={`a2a-task-report__state is-${protocolStateTone(report.state)}`}>{protocolStateLabel(report.state)}</strong>
    </p>
    {report.text || report.artifacts.length ? <details className="a2a-task-report__content" open={needsInput}>
      <summary>{t("a2a.reports.preview")}</summary>
      {report.text ? <div className="a2a-task-report__text">
        <p>{report.text}</p>{report.textTruncated ? <small>{t("a2a.reports.truncated")}</small> : null}
      </div> : null}
      {report.artifacts.length ? <ul className="a2a-task-report__artifacts">{report.artifacts.map(artifact => <li key={artifact.artifactId}>
        <strong>{artifact.name || t("a2a.reports.artifact")}</strong><p>{artifact.text}</p>
        {artifact.truncated ? <small>{t("a2a.reports.truncated")}</small> : null}
      </li>)}</ul> : null}
    </details> : null}
  </section>;
}
