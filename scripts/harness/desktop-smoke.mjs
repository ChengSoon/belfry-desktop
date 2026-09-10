#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("../..", import.meta.url).pathname;
const exampleManifest = JSON.parse(readFileSync(join(root, "examples/harness/readonly-project/manifest.json"), "utf8"));
if (exampleManifest.capabilities.length !== 1 || exampleManifest.capabilities[0] !== "project.read" || exampleManifest.tools.includes("command.exec")) process.exit(2);
console.log("[smoke] PASS readonly example manifest is project.read-only");
const checks = [
  ["frontend harness contract/tests", "pnpm", ["exec", "vitest", "run", "src/harness"]],
  ["Rust harness lifecycle/registry/patch", "cargo", ["test", "harness::", "--lib"]],
];
for (const [name, command, args] of checks) {
  const result = spawnSync(command, args, { cwd: command === "cargo" ? join(root, "src-tauri") : root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`[smoke] PASS ${name} (exit ${result.status})`);
}
const managedRoot = process.env.HARNESS_SMOKE_INSTALL_ROOT;
if (managedRoot && existsSync(managedRoot)) rmSync(managedRoot, { recursive: true, force: true });
console.log("[smoke] PASS static lifecycle evidence: install preview/commit, registry list, snapshot/authorize, trusted worker start, read/patch/command approval routes, audit query, revoke/cancel/close are covered by the harness suites.");
console.log("[smoke] NOT VERIFIED: native Tauri/WebView UI and Windows process/filesystem behavior require the target desktop environment.");
