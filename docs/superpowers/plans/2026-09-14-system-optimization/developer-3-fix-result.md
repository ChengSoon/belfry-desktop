# 开发3整合修复结果

任务：`dmbq2dja`；日期：2026-09-15；当前共享分支 `feat/multi-agent-collab`。
已处理 `developer-2-cross-review.md` 的 1 项 P1、3 项 P2，并完成先失败、后修复的定向验证。
使用 `belfry` 技能；未提交、推送或触发远程 workflow。

## 实际修改

1. **发布 API 资产 URL 与错误下载路径：** `.github/workflows/release-assets.mjs:18` 先取得当前 release 的非空资产，
   在 `:25` 精确匹配其 `url` 或 `browser_download_url`，从匹配记录取得文件名检查签名和跨目标重复。
   不再从 URL 尾段猜文件名或仅检查下载路径前缀。API ID URL、网页下载 URL 均可用；多余路径、未知资产 ID、
   外仓库、query/fragment/凭据变体及空资产均不能借用另一个同名文件通过。
2. **真实格式回归：** `.github/workflows/release-assets.case.mjs` 的 fixture 包含 API 返回的 `id/name/size/url/browser_download_url`。
   正例使用 `https://api.github.com/repos/ChengSoon/belfry-desktop/releases/assets/100` 这一 Action v1 格式；
   另覆盖同一资产的两种 URL 被分配给不同目标、错误路径、未知 ID 和空资产。保留既有版本、平台、签名、安装器和响应解析检查。
3. **sidecar 锁文件门禁：** `scripts/bundle-cli.mjs:24` 的共用 Cargo 参数增加 `--locked`，debug/release 都生效。
   新增唯一一个 scripts 回归文件 `scripts/bundle-cli.case.mjs`：复制真实脚本到独立临时 Cargo workspace，
   无外部依赖、禁止网络访问，执行真实 Cargo。有效锁会编译、复制并执行 host CLI；过期锁在两种模式下都必须失败、
   锁文件字节完全不变且不生成 sidecar。临时 workspace 及其编译产物由测试清理。
4. **Node 20 CSS 测试：** `src/components/lazy/testing/production-panels.case.mjs:44` 改用普通 Promise 保存 resolver，
   保留第三次 CSS 响应受控挂起、响应到达前不展示面板的原断言；未修改面板产品实现。
5. **CI 与文档：** `.github/workflows/checks.yml:58` 在既有 LTS 检查之后切换到 Node 20，
   在 macOS/Windows 都运行发布、sidecar、生产面板的定向集合，直接复用前一步 dist；截图使用独立 `node20` 子目录。
   两个 README 同步 sidecar 的 `--locked` 行为、回归命令及 Node 20 检查范围。

Action 格式已回读审查留下的官方源码：`upload-version-json.ts:97` 按资产 ID 生成 API URL、`:242` 写入平台条目；
对应官方版本为 `1deb371b0cd8bd54025b384f1cd735e725c4060f`。fixture 采用其输出结构，不依赖网络下载或真实发布。

## 先失败复现

以下均使用本机现有 `/Users/cheng/.nvm/versions/node/v20.19.0/bin/node`，在产品修复之前实际执行，退出码均为 **1**：

| 定向命令（下列 `node` 均为上述 Node 20） | 实际结果 | 日志 |
| --- | --- | --- |
| `node --test .github/workflows/release-assets.case.mjs` | 4 通过、4 失败；真实 API URL 被拒绝，`/download/extra/v0.20.2/...` 被错误放行 | `/tmp/belfry-developer3-fix-release-before.log` |
| `node --test scripts/bundle-cli.case.mjs` | 1 通过、2 失败；debug/release 子进程均 exit 0，并修改了过期锁 | `/tmp/belfry-developer3-fix-sidecar-before.log` |
| `node --test --test-name-pattern='production CSS retries' src/components/lazy/testing/production-panels.case.mjs` | 目标用例失败：`Promise.withResolvers is not a function`；3 项因名称筛选跳过 | `/tmp/belfry-developer3-fix-css-before.log` |

过期锁复现先为 `belfry-cli 0.1.0` 生成锁，然后只把临时 manifest 改成 `0.2.0`。
修复前两种模式的锁 SHA256 均从 `e8a50a433c661dc37698b4910c264a189c827641e44812196f584576390bbc52`
变为 `549bf4af8255bef66f1c558c44a0abd09728ee7e60e81979020202f5495ff32b`，并非 mock Cargo 参数得到的结论。

## 修复后验证

实际环境：macOS ARM64、Node **v20.19.0**、Cargo/Rust **1.97.1**。未安装或升级依赖。
在仓库根目录执行与 CI 相同的定向集合，命令退出码 **0**，**15 项通过、0 失败、0 跳过**：

```sh
BELFRY_PANEL_ARTIFACTS=/tmp/belfry-developer3-fix-node20-qa \
  /Users/cheng/.nvm/versions/node/v20.19.0/bin/node \
  --test --test-concurrency=1 \
  .github/workflows/release-assets.case.mjs \
  scripts/bundle-cli.case.mjs \
  src/components/lazy/testing/production-panels.case.mjs
```

- 发布校验 **8 项**：Action API 正例、原网页下载正例通过；错误路径和资产对应关系负例均被拒绝。
- sidecar **3 项**：有效锁下真实 CLI 构建/复制/执行成功；过期锁 debug/release 子进程均 exit 1，错误来自 Cargo `--locked`，
  前后 SHA256 均为上文 `e8a50a...bbc52`，并逐字节比较一致。
- 生产面板 **4 项**：入口 JS 首次 503、CSS 首次 503、连续 CSS 503 后挂起再恢复、DatePicker 共享依赖失败恢复边界均通过。
  使用原样 dist 和真实 HTTP 503；原终端节点、会话创建次数、输入、无 detach/close 和文档身份断言均保留。

完整日志：`/tmp/belfry-developer3-fix-node20.log`；截图产物：`/tmp/belfry-developer3-fix-node20-qa/`。
另执行两个 workflow 的 Ruby/Psych YAML 解析、`git diff --check`，均 exit 0；修改脚本/测试的行数与空白检查通过。

## 范围、构建复用与限制

- 本次只改 `.github/workflows/release-assets.mjs`、`release-assets.case.mjs`、`checks.yml`，
  `src/components/lazy/testing/production-panels.case.mjs`，明确追加授权的 `scripts/bundle-cli.mjs`、`scripts/bundle-cli.case.mjs`，
  两个 README 及开发3结果文档。未修改其他开发的文件、依赖或锁文件。
- `src-tauri/Cargo.lock`、`pnpm-lock.yaml`、`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`
  的任务前后 SHA256 一致。仓库 Cargo.lock 为 `c0060b6fef6a0f6a1fe3c72c6737627712a6614243ac58bbccd97c908676e766`。
- 复用现有 dist 的 **27 个文件**，未运行 `pnpm build` 或真实项目 Rust 全量构建。
  按排序路径与各文件 SHA256 计算的树指纹前后一致：`f08b3e6e8c098dd014fe18596d46490d0038bbdda900fed6b5b0761d0a135897`。
  Rust 编译仅发生在无外部依赖的临时 sidecar fixture 中。
- 本机通过不等同于 Windows 实机、GitHub 远程 workflow、真实签名发布或更新客户端下载端到端验收；这些仍由项目经理统一收口。
  `developer-3-result.md` 中更早的全量验证数字继续作为历史证据，本报告只声明本次实际运行的 15 项定向回归。
