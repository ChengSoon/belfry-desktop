import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflow = (await readFile(new URL("./checks.yml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const defaultShell = workflow.match(/^    defaults:\n      run:\n(?:        #[^\n]*\n)*        shell: (\w+)$/m)?.[1];
const steps = workflow.split(/^      - /m).slice(1).flatMap(block => {
  const run = block.match(/(?:^|\n        )run: \|\n((?:          .*\n)+)/);
  if (!run) return [];
  return [{ name: block.match(/^name: (.+)/)?.[1] ?? "unnamed step",
    shell: block.match(/^        shell: (\w+)$/m)?.[1] ?? defaultShell ?? (process.platform === "win32" ? "pwsh" : "bash") }];
});

async function probe(t, shell, pipeline = false) {
  const root = await mkdtemp(join(tmpdir(), "belfry-check-shell-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  await writeFile(join(root, "fail.cjs"), "process.exit(1);\n");
  await writeFile(join(root, "success.cjs"), "process.exit(0);\n");
  await writeFile(join(root, "tail.cjs"), "require('node:fs').writeFileSync('tail-ran', 'yes'); process.exit(0);\n");
  const commands = pipeline ? "node fail.cjs | node success.cjs\nnode tail.cjs\n" : "node fail.cjs\nnode tail.cjs\n";
  let args;
  if (shell === "bash") {
    await writeFile(join(root, "probe.sh"), commands);
    // The documented GitHub Actions invocation for an explicit bash shell.
    args = ["--noprofile", "--norc", "-e", "-o", "pipefail", "probe.sh"];
  } else if (shell === "pwsh") {
    // The runner's default PowerShell wrapper checks only the final native exit code.
    await writeFile(join(root, "probe.ps1"), "$ErrorActionPreference = 'stop'\n" + commands
      + "if (Test-Path -LiteralPath variable:\\LASTEXITCODE) { exit $LASTEXITCODE }\n");
    args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ". './probe.ps1'"];
  } else {
    assert.fail(`Unsupported CI shell in execution regression: ${shell}`);
  }
  const result = spawnSync(shell, args, { cwd: root, encoding: "utf8", timeout: 20_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return { status: result.status, tailRan: existsSync(join(root, "tail-ran")), stderr: result.stderr };
}

test("every multi-command CI step fails on an earlier native command error", async t => {
  assert.ok(defaultShell, "declare the cross-platform default shell explicitly");
  assert.ok(steps.length >= 3, "exercise every existing multi-command run block");
  for (const step of steps) {
    const result = await probe(t, step.shell);
    assert.equal(result.status, 1, `${step.name}: ${JSON.stringify(result)}`);
    assert.equal(result.tailRan, false, step.name);
    t.diagnostic(JSON.stringify({ step: step.name, shell: step.shell, ...result }));
  }
});

test("the CI default shell also rejects failures inside a pipeline", async t => {
  const shell = defaultShell ?? (process.platform === "win32" ? "pwsh" : "bash");
  const result = await probe(t, shell, true);
  assert.equal(result.status, 1, JSON.stringify(result));
  assert.equal(result.tailRan, false);
});

test("Windows reproduces the old PowerShell failure masking before checking the fixed workflow", {
  skip: process.platform !== "win32" ? "requires the Windows runner's real pwsh" : false,
}, async t => {
  const old = await probe(t, "pwsh");
  assert.equal(old.status, 0, JSON.stringify(old));
  assert.equal(old.tailRan, true);
  const fixed = await probe(t, defaultShell ?? "pwsh");
  assert.equal(fixed.status, 1, JSON.stringify(fixed));
  assert.equal(fixed.tailRan, false);
  t.diagnostic(JSON.stringify({ oldPowerShell: old, workflow: fixed }));
});
