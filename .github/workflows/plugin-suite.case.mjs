import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectTap } from "./plugin-suite.mjs";

const RUNNER = new URL("./plugin-suite.mjs", import.meta.url).href;
const ENTRY = fileURLToPath(new URL("./verify-plugins.mjs", import.meta.url));
const COMPLETE = "TAP version 13\nok 1 - completed\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n";
const PARTIAL_FAILURE = "TAP version 13\nnot ok 1 - retained layout failure\n  ---\n  error: '73.484375 < 80'\n  ...\n";
function childEnvironment() {
  // A new runner must not inherit node:test's recursive-run marker from this case.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; return env;
}

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), "belfry-suite-runner-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  return root;
}
async function probe(t, { content = COMPLETE, exit = 0, hang = false, signal = false, missing = false,
  actual, blockedReport = false, preexisting = false } = {}) {
  const root = await directory(t), outputPath = join(root, "current.tap"), resultPath = join(root, "result.json");
  const child = join(root, "child.mjs"), driver = join(root, "driver.mjs");
  const artifactRoot = join(root, "artifacts"), stepSummary = join(root, "summary.md");
  if (blockedReport) await writeFile(artifactRoot, "not a directory");
  if (preexisting) await writeFile(outputPath, COMPLETE);
  await writeFile(child, actual ?? `import { writeFileSync } from 'node:fs';
    ${content === null ? "" : `writeFileSync(${JSON.stringify(outputPath)}, ${JSON.stringify(content)});`}
    ${signal ? "process.kill(process.pid, 'SIGTERM');" : hang ? "setInterval(() => {}, 1000);" : `process.exitCode = ${exit};`}`);
  const args = actual ? ["--test", "--test-reporter=tap", `--test-reporter-destination=${outputPath}`, child] : [child];
  await writeFile(driver, `import { writeFileSync } from 'node:fs';
    import { runPluginSuite } from ${JSON.stringify(RUNNER)};
    const report = runPluginSuite({ args: ${JSON.stringify(args)}, outputPath: ${JSON.stringify(outputPath)},
      executable: ${JSON.stringify(missing ? join(root, "missing-executable") : process.execPath)}, files: ['controlled.case.mjs'],
      budget: {suiteTimeoutMs: ${hang ? 2000 : 10_000}, testTimeoutMs: 300000, concurrency: 1},
      env: {...process.env, BELFRY_PANEL_ARTIFACTS: ${JSON.stringify(artifactRoot)}, GITHUB_STEP_SUMMARY: ${JSON.stringify(stepSummary)}} });
    writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(report)); process.exitCode = report.exitCode;`);
  const childResult = spawnSync(process.execPath, [driver], { cwd: root, env: childEnvironment(), encoding: "utf8", timeout: 15_000 });
  assert.ifError(childResult.error);
  assert.equal(childResult.signal, null, childResult.stderr);
  const report = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(childResult.status, report.exitCode);
  t.diagnostic(JSON.stringify({ exitCode: childResult.status, child: report.child, elapsedMs: report.elapsedMs,
    complete: report.tap.complete, topLevel: report.tap.topLevel, issues: report.issues }));
  return { report, status: childResult.status, text: await readFile(outputPath, "utf8"), stdout: childResult.stdout,
    summary: await readFile(stepSummary, "utf8") };
}

test("actual entry discovers all mandatory directories and completes a miniature Node suite", async (t) => {
  const root = await directory(t);
  const files = ["scripts/plugin-tests/required.case.mjs", "src/components/lazy/testing/required.case.mjs",
    "src/workspace/testing/required.case.mjs", "src/git/testing/required.case.mjs", "scripts/test-command-library.mjs"];
  for (const file of files) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), `import test from 'node:test'; test(${JSON.stringify(file)}, () => {});`);
  }
  for (const file of ["upstream-runtime.case.mjs", "todo-interop.case.mjs"]) {
    await writeFile(join(root, "scripts/plugin-tests", file), "throw new Error('unconfigured upstream fixture must remain excluded');");
  }
  await mkdir(join(root, "dist")); await writeFile(join(root, "dist/index.html"), "fixture");
  const result = spawnSync(process.execPath, [ENTRY], { cwd: root, encoding: "utf8", timeout: 15_000,
    env: { ...childEnvironment(), GITHUB_ACTIONS: "true", BELFRY_BROWSER_EXECUTABLE: process.execPath,
      BELFRY_PI_SOURCE: "", BELFRY_PANEL_ARTIFACTS: join(root, "artifacts"), GITHUB_STEP_SUMMARY: join(root, "summary.md") } });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(await readFile(join(root, "artifacts/plugin-suite-summary.json"), "utf8"));
  assert.deepEqual(report.files.map((file) => file.replaceAll("\\", "/")).sort(), files.sort());
  assert.equal(report.tap.complete, true); assert.equal(report.tap.summary.tests, 5); assert.equal(report.tap.summary.skipped, 0);
  assert.equal(report.budget.testTimeoutMs, 300000);
  assert.equal(report.budget.concurrency, process.platform === "darwin" ? 1 : 2);
  assert.equal(report.budget.suiteTimeoutMs, (process.platform === "darwin" ? 30 : 20) * 60_000);
  assert.ok(report.budget.suiteTimeoutMs + 305_000 < 45 * 60_000);
  t.diagnostic(JSON.stringify({ files: report.files, budget: report.budget, actual: report.tap.summary }));
});

test("real Node TAP with nested suites is complete, while a real assertion failure remains nonzero", async (t) => {
  const source = "import test, {describe} from 'node:test'; import assert from 'node:assert/strict'; test('one',()=>{}); describe('group',()=>{test('nested',()=>{});});";
  const success = await probe(t, { actual: source });
  assert.equal(success.status, 0); assert.equal(success.report.tap.complete, true);
  assert.equal(success.report.tap.summary.tests, 2); assert.equal(success.report.tap.summary.suites, 1);
  const failure = await probe(t, { actual: source + "test('retained layout failure',()=>{assert.ok(73.484375>=80);});" });
  assert.equal(failure.status, 1); assert.equal(failure.report.tap.complete, true);
  assert.equal(failure.report.tap.topLevel.failed, 1); assert.match(failure.summary, /retained layout failure/);
});

test("timeout retains earlier assertion failures, partial TAP and an unknown remaining count", async (t) => {
  const result = await probe(t, { content: PARTIAL_FAILURE, hang: true });
  assert.equal(result.status, 124); assert.equal(result.report.child.error.code, "ETIMEDOUT");
  assert.equal(result.report.tap.complete, false); assert.equal(result.report.tap.topLevel.failed, 1);
  assert.equal(result.report.tap.remainingTopLevel, null); assert.equal(result.text, PARTIAL_FAILURE);
  assert.match(result.stdout, /retained layout failure/); assert.match(result.summary, /unknown \(no final plan\)/);
  assert.ok(result.report.elapsedMs >= 1900 && result.report.elapsedMs < 10_000);
});

test("signals and explicit child failure cannot turn complete TAP into success", async (t) => {
  const signalled = await probe(t, { signal: true });
  assert.notEqual(signalled.status, 0); assert.ok(signalled.report.child.signal || signalled.report.child.status > 0);
  assert.equal(signalled.text, COMPLETE);
  const exited = await probe(t, { exit: 7 });
  assert.equal(exited.status, 7); assert.equal(exited.report.tap.complete, true);
});

test("exit zero cannot accept missing, truncated or inconsistent TAP or reuse a stale result", async (t) => {
  for (const content of [null, PARTIAL_FAILURE, COMPLETE.replace("1..1\n", ""), COMPLETE.replace("# duration_ms 1\n", ""),
    COMPLETE.replace("1..1", "1..2"), COMPLETE.replace("# tests 1", "# tests 2")]) {
    const result = await probe(t, { content, preexisting: true });
    assert.equal(result.report.child.status, 0); assert.equal(result.status, 1); assert.equal(result.report.tap.complete, false);
    if (content === null) assert.equal(result.text, "");
  }
});

test("real skipped and TODO tests remain mandatory-gate failures despite a successful child exit", async (t) => {
  for (const kind of ["skip", "todo"]) {
    const result = await probe(t, { actual: `import test from 'node:test'; test.${kind}('unfinished mandatory case',()=>{});` });
    assert.equal(result.report.child.status, 0); assert.equal(result.status, 1);
    assert.ok(result.report.issues.includes(kind === "skip" ? "skipped-tests" : "todo-tests"));
  }
});

test("spawn/report failures remain nonzero and TAP-like YAML is never counted as test output", async (t) => {
  const missing = await probe(t, { missing: true });
  assert.equal(missing.status, 1); assert.equal(missing.report.child.error.code, "ENOENT");
  const blocked = await probe(t, { blockedReport: true });
  assert.equal(blocked.status, 1); assert.equal(blocked.text, COMPLETE);
  assert.ok(blocked.report.issues.some((issue) => issue.startsWith("report-write:")));
  const text = COMPLETE.replace("ok 1 - completed\n", "ok 1 - completed\n  ---\n  note: |\n    not ok 42 - quoted text\n  ...\n");
  assert.equal(inspectTap(text).assertions, 1); assert.equal(inspectTap(text).complete, true);
});
