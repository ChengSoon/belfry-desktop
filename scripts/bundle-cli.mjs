#!/usr/bin/env node
// 把 belfry 控制 CLI 编译成 Tauri sidecar 要的形状。
//
// Tauri 按 `belfry-{target-triple}{.exe}` 找 externalBin，打包后再去掉后缀
// 放进 bundle——和主程序同一个目录，正好是 launch.rs 的 cli_directory()
// 期望的位置。
//
// 目标平台从 TAURI_ENV_TARGET_TRIPLE 读：CI 上 macOS 要分别出 aarch64 和
// x64 两份，只认 host triple 会两次都打出同一个架构的二进制。

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");
const outDir = join(tauriDir, "binaries");

const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTriple();
const debug = process.env.TAURI_ENV_DEBUG === "true";
const exeSuffix = triple.includes("windows") ? ".exe" : "";

const args = ["build", "-p", "belfry-cli"];
if (!debug) args.push("--release");
// 只在打包时按 triple 交叉编译。dev 只在本机跑，传了 --target 反而会把产物
// 放进 target/{triple}/debug/，而主程序在 target/debug/——cli_directory()
// 只看主程序旁边，就会找不到。
const crossCompiling = !debug && Boolean(process.env.TAURI_ENV_TARGET_TRIPLE);
if (crossCompiling) args.push("--target", triple);

run("cargo", args);

const profile = debug ? "debug" : "release";
const built = crossCompiling
  ? join(tauriDir, "target", triple, profile, `belfry${exeSuffix}`)
  : join(tauriDir, "target", profile, `belfry${exeSuffix}`);

mkdirSync(outDir, { recursive: true });
const target = join(outDir, `belfry-${triple}${exeSuffix}`);
copyFileSync(built, target);
console.log(`belfry sidecar → ${target}`);

function run(command, commandArgs) {
  execFileSync(command, commandArgs, { cwd: tauriDir, stdio: "inherit" });
}

/** 没有 Tauri 注入的变量时（比如手动跑），退回本机架构。 */
function hostTriple() {
  const output = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const line = output.split("\n").find((entry) => entry.startsWith("host:"));
  if (!line) throw new Error("rustc -vV 里没有 host 行，无法确定目标平台");
  return line.slice("host:".length).trim();
}
