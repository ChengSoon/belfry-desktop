// Node 枚举文件，避免 PowerShell 与 POSIX shell 对 glob 的不同处理。
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { browserExecutable } from "../../src-tauri/src/plugins/node/browser-process.mjs";

const upstreamCases = new Set(["upstream-runtime.case.mjs", "todo-interop.case.mjs"]);
const upstream = process.env.BELFRY_PI_SOURCE;
const explanation = upstream
  ? "原版 PI 互操作使用 BELFRY_PI_SOURCE 指定的固定版本源码与 market-fixtures。"
  : "未提供 BELFRY_PI_SOURCE：4 项原版 PI Browser/Git Lens/Log Viewer/Todo 互操作另行验收；仓库自带的全部插件与浏览器回归仍为必跑。";

if (!existsSync("dist/index.html")) throw new Error("生产面板回归缺少 dist/index.html；请先执行 pnpm build。");
console.log("Production panel regression: serve dist unchanged; inject real JS/CSS/shared dependency HTTP failures.");
console.log(`Browser: ${await browserExecutable()}`);
if (upstream) checkUpstreamFixtures(upstream);
console.log(explanation);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${explanation}\n`);
const suites = readdirSync("scripts/plugin-tests")
  .filter((name) => name.endsWith(".case.mjs") && (upstream || !upstreamCases.has(name)))
  .map((name) => join("scripts/plugin-tests", name));
for (const directory of ["src/components/lazy/testing", "src/workspace/testing"]) {
  suites.push(...readdirSync(directory).filter((name) => name.endsWith(".case.mjs")).map((name) => join(directory, name)));
}
suites.push("scripts/test-command-library.mjs");
const testTimeoutMs = 5 * 60 * 1000;
// macOS 全量约 3.5 分钟，Windows 惯常慢 2~3 倍；留到 20 分钟既不误杀，也远早于 45 分钟的 job 上限。
const suiteTimeoutMs = 20 * 60 * 1000;
const outputPath = process.env.GITHUB_ACTIONS ? "plugin-tests.tap"
  : join(process.env.TMPDIR ?? process.env.TEMP ?? "/tmp", "belfry-developer3-plugin-tests.tap");
// 实时打印进度，同时持续写入 TAP；测试卡住时也能保留最后完成的用例和超时结果。
// --test-force-exit：用例判定完成后立即退出。否则残留句柄（Windows 上 kill 父进程留下的
// 孙子进程会继承管道）会让运行器在全部通过后静默挂起，--test-timeout 也管不到，
// 直到外层 spawnSync 超时才被杀掉，且此时结果按文件顺序积压、后续文件一条都打不出来。
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=2", `--test-timeout=${testTimeoutMs}`,
  "--test-force-exit",
  "--test-reporter=spec", "--test-reporter-destination=stdout",
  "--test-reporter=tap", `--test-reporter-destination=${outputPath}`, ...suites.sort()], {
  stdio: "inherit", timeout: suiteTimeoutMs,
  env: { ...process.env, BELFRY_REQUIRE_BROWSER_TESTS: "1" },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const output = readFileSync(outputPath, "utf8");
if (/^# (?:SKIP|skip\b)|# SKIP\b|^# skipped [1-9]/m.test(output)) throw new Error("必跑回归出现跳过项，请检查浏览器或测试环境");

function checkUpstreamFixtures(root) {
  const plugins = ["apps/desktop/resources/plugins/pi.browser", "market-fixtures/pi.gitlens",
    "market-fixtures/pi.log-viewer", "market-fixtures/pi.todo"];
  for (const plugin of plugins) {
    if (!existsSync(join(root, plugin, "manifest.json"))) throw new Error(`缺少上游插件 fixture：${plugin}`);
  }
}
