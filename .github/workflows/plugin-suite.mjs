import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function suiteBudget(platform = process.platform) {
  // CI42670683970: macOS exhausted 20min after 282 top-level cases; Windows
  // completed all 313 tests in 586s. macOS's measured 305s preparation + 30min
  // leaves 595s of the 45min job for Node20, upload and variation. See the doc.
  return { suiteTimeoutMs: (platform === "darwin" ? 30 : 20) * 60 * 1000,
    testTimeoutMs: 5 * 60 * 1000, concurrency: platform === "darwin" ? 1 : 2 };
}

/** Inspect Node's TAP reporter, including nested assertions and its final summary. */
export function inspectTap(source) {
  // YAML diagnostics can themselves quote TAP-looking lines. They are evidence,
  // not extra test results; keep them in the original file but exclude from counts.
  let diagnosticIndent = null;
  const text = source.replace(/\r\n/g, "\n").split("\n").filter((line) => {
    if (diagnosticIndent !== null) {
      if (line === `${diagnosticIndent}...`) diagnosticIndent = null;
      return false;
    }
    const opening = line.match(/^( +)---$/);
    if (opening) { diagnosticIndent = opening[1]; return false; }
    return true;
  }).join("\n");
  const rows = [...text.matchAll(/^( *)(not ok|ok) (\d+)(?: - (.*))?$/gm)]
    .map((match) => ({ depth: match[1].length, ok: match[2] === "ok", id: Number(match[3]), name: match[4] ?? "" }));
  const roots = rows.filter((row) => row.depth === 0), plans = [...text.matchAll(/^1\.\.(\d+)$/gm)];
  const plan = plans.length === 1 ? Number(plans[0][1]) : null;
  const summary = {}, missingSummary = [];
  for (const key of ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo", "duration_ms"]) {
    const values = [...text.matchAll(new RegExp(`^# ${key} (\\d+(?:\\.\\d+)?)$`, "gm"))];
    if (values.length === 1) summary[key] = Number(values[0][1]); else missingSummary.push(key);
  }
  const structural = [];
  if (!text.startsWith("TAP version 13\n")) structural.push("missing-tap-header");
  if (plan === null) structural.push("missing-or-duplicate-final-plan");
  else if (plan < 1 || plan !== roots.length || roots.some((row, index) => row.id !== index + 1)) structural.push("plan-mismatch");
  if (missingSummary.length) structural.push("missing-or-duplicate-final-summary");
  else if (summary.tests < 1 || summary.tests + summary.suites !== rows.length
    || summary.tests !== summary.pass + summary.fail + summary.cancelled + summary.skipped + summary.todo) structural.push("summary-mismatch");
  const failures = rows.filter((row) => !row.ok);
  const skip = rows.filter((row) => /# SKIP\b/i.test(row.name)).length;
  const todo = rows.filter((row) => /# TODO\b/i.test(row.name)).length;
  const issues = [...structural];
  if (failures.length || summary.fail > 0 || summary.cancelled > 0) issues.push("failed-or-cancelled-tests");
  // Preserve the original mandatory-suite skip gate as well as parsed directives.
  if (skip || summary.skipped > 0 || /^# (?:SKIP|skip\b)|# SKIP\b|^# skipped [1-9]/m.test(source)) issues.push("skipped-tests");
  if (todo || summary.todo > 0) issues.push("todo-tests");
  if (/^[ \t]*Bail out!/mi.test(text)) issues.push("tap-bailout");
  return { complete: structural.length === 0, plan, remainingTopLevel: plan === null ? null : Math.max(0, plan - roots.length),
    topLevel: { completed: roots.length, passed: roots.filter((row) => row.ok && !/# (?:SKIP|TODO)\b/i.test(row.name)).length,
      failed: roots.filter((row) => !row.ok).length },
    assertions: rows.length, summary: missingSummary.length ? null : summary,
    failureCount: failures.length, failures: failures.slice(0, 32).map((row) => ({ ...row, name: row.name.slice(0, 1024) })), issues };
}

export function formatSuiteReport(report) {
  const tap = report.tap;
  return [`Plugin/browser result: ${report.exitCode === 0 ? "success" : "failure"}; elapsed ${(report.elapsedMs / 1000).toFixed(3)}s / ${(report.budget.suiteTimeoutMs / 1000)}s budget.`,
    `Child: exit=${report.child.status}, signal=${report.child.signal}, error=${report.child.error?.code ?? "none"}. Discovered files: ${report.files.length}.`,
    `TAP: ${tap.complete ? "complete" : "INCOMPLETE"}; top-level completed=${tap.topLevel.completed}, passed=${tap.topLevel.passed}, failed=${tap.topLevel.failed}; observed assertions=${tap.assertions}.`,
    tap.summary ? `Final summary: tests=${tap.summary.tests}, pass=${tap.summary.pass}, fail=${tap.summary.fail}, cancelled=${tap.summary.cancelled}, skipped=${tap.summary.skipped}, todo=${tap.summary.todo}.`
      : "Final summary: unavailable; observed counts are partial.",
    `Remaining top-level cases: ${tap.remainingTopLevel ?? "unknown (no final plan)"}. Issues: ${report.issues.join(", ") || "none"}.`,
    ...tap.failures.map((row) => `Recorded failure ${row.depth ? "(nested) " : ""}#${row.id}: ${row.name}`),
    `TAP retained: ${report.outputPath}; report: ${report.reportPath}.`].join("\n");
}

/** Same synchronous child execution as before; always inspect retained TAP, even on timeout. */
export function runPluginSuite({ args, outputPath, files, budget = suiteBudget(), executable = process.execPath,
  cwd = process.cwd(), env = process.env }) {
  outputPath = resolve(cwd, outputPath);
  const started = performance.now(); let result;
  try {
    // A failed spawn must not accidentally validate a previous invocation's TAP.
    writeFileSync(outputPath, "");
    result = spawnSync(executable, args, { cwd, stdio: "inherit", timeout: budget.suiteTimeoutMs, env });
  } catch (error) { result = { status: null, signal: null, error }; }
  const elapsedMs = performance.now() - started;
  let output = "", readError;
  try { output = readFileSync(outputPath, "utf8"); } catch (error) { readError = error.code ?? "READ_ERROR"; }
  const tap = inspectTap(output), issues = [...tap.issues];
  if (readError) issues.push(`tap-read:${readError}`);
  if (result.error) issues.push(`execution:${result.error.code ?? "ERROR"}`);
  if (result.signal) issues.push(`signal:${result.signal}`);
  if (result.status !== 0) issues.push(`child-exit:${result.status ?? "unknown"}`);
  const report = { schemaVersion: 1, budget, elapsedMs, files, outputPath,
    reportPath: env.BELFRY_PANEL_ARTIFACTS ? join(env.BELFRY_PANEL_ARTIFACTS, "plugin-suite-summary.json") : `${outputPath}.summary.json`,
    child: { status: result.status, signal: result.signal,
      error: result.error ? { code: result.error.code ?? "ERROR", message: result.error.message.slice(0, 1024) } : null },
    tap, issues, exitCode: result.error?.code === "ETIMEDOUT" ? 124
      : result.status > 0 ? result.status : issues.length ? 1 : 0 };
  if (env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(env.GITHUB_STEP_SUMMARY, `\n\n${formatSuiteReport(report)}\n`); }
    catch (error) { report.issues.push(`step-summary-write:${error.code ?? "ERROR"}`); report.exitCode ||= 1; }
  }
  try {
    mkdirSync(dirname(report.reportPath), { recursive: true });
    writeFileSync(report.reportPath, JSON.stringify(report, null, 2) + "\n");
  } catch (error) { report.issues.push(`report-write:${error.code ?? "ERROR"}`); report.exitCode ||= 1; }
  console.log(formatSuiteReport(report));
  return report;
}
