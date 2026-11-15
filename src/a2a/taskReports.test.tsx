import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { setLocalePreference } from "../i18n";
import type { ProtocolTaskPreview, TaskRef } from "./contracts";
import { TaskReportPreview } from "./TaskReports";
import { protocolStateLabel, protocolStateTone, taskReferenceKey, taskReportFor, taskReportIndex } from "./taskReportModel";
import { localAgentReason } from "./peers";

const reference: TaskRef = { kind: "room_task", roomId: "room-1", id: "T1", generation: 7 };
const report = (extra: Partial<ProtocolTaskPreview> = {}): ProtocolTaskPreview => ({ taskRef: reference, protocolTaskId: "protocol-1", state: "TASK_STATE_WORKING", source: "localA2A", text: "Started review", textTruncated: false, artifacts: [], ...extra });
afterEach(() => setLocalePreference("zh-CN"));

it("associates protocol reports by exact business identity and generation, preserving native instance precedence", () => {
  const current = report(), oldInstance = report({ protocolTaskId: "old-instance", state: "TASK_STATE_COMPLETED" });
  const index = taskReportIndex([current, oldInstance]);
  expect(taskReportFor(index, reference)).toBe(current);
  for (const wrong of [{ ...reference, generation: 6 }, { ...reference, roomId: "room-2" }, { ...reference, id: "T10" },
    { ...reference, kind: "direct_task" as const, roomId: null }]) expect(taskReportFor(index, wrong)).toBeUndefined();
  expect(taskReportFor(index, undefined)).toBeUndefined();
  expect(taskReferenceKey({ ...reference, generation: Number.NaN })).toBeNull();
  expect(taskReferenceKey({ ...reference, kind: "direct_task" })).toBeNull();
  expect(taskReportIndex([report({ source: "external" as "localA2A" })]).size).toBe(0);
  expect(current.taskRef.generation).toBe(7);
});

it("shows explicit input requests, safe text and truncated artifacts without inferring business completion", () => {
  setLocalePreference("en");
  const html = renderToStaticMarkup(<TaskReportPreview report={report({ state: "TASK_STATE_INPUT_REQUIRED", text: "Which branch? <script>unsafe()</script>", textTruncated: true,
    artifacts: [{ artifactId: "artifact-1", name: "Draft", text: "Partial review", truncated: true }] })} />);
  expect(html).toContain("Local A2A · explicit report"); expect(html).toContain("Input required");
  expect(html).toContain('open=""'); expect(html).toContain("Which branch? &lt;script&gt;"); expect(html).not.toContain("<script>");
  expect(html.match(/Preview truncated/g)).toHaveLength(2);
  expect(html).toContain("Partial review"); expect(html).toContain('data-task-generation="7"');
  expect(html).not.toContain("Completed");
});

it("keeps unknown and nonterminal states unconfirmed, localizes reports and the stable availability codes", () => {
  setLocalePreference("en");
  expect(protocolStateLabel("FUTURE_STATE")).toBe("Unknown state · completion unconfirmed");
  for (const state of ["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED", "FUTURE_STATE"]) expect(protocolStateTone(state)).not.toBe("done");
  expect(localAgentReason("adapterUnsupported")).toContain("no verified");
  expect(localAgentReason("instanceUnavailable")).toContain("not running");
  expect(localAgentReason("adapterNotReady")).toContain("has not read");
  expect(protocolStateLabel("TASK_STATE_FAILED")).toBe("Failed");
  setLocalePreference("zh-CN");
  expect(protocolStateLabel("TASK_STATE_WORKING")).toBe("进行中");
  expect(protocolStateLabel("TASK_STATE_COMPLETED")).toBe("已完成");
});
