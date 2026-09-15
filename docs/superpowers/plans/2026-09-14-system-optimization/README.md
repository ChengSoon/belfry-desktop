# Belfry 系统优化执行与派发

用户要求：使用 Belfry，把本轮识别的 6 项优化交给三个已命名开发会话执行。
基线：`439302a`，分支 `feat/multi-agent-collab`，派发前工作区干净。

## 目标与验收来源

1. 用量查询增量缓存、重复查询合并与真实后台取消。
2. 终端输出按消费进度投递，限制待处理数据，保留后台运行和明确的回放缺口语义。
3. PR 阶段自动执行前端、Rust 与插件测试，配置 macOS / Windows 验证。
4. 接续 Hook、统计、Worktree 和 Windows 的已有验收，不把未验证项标记完成。
5. 可选面板按需加载，测量拆包结果并验证打开、关闭和重试。
6. 按职责整理终端控制器与工作区 Hook，修正 README 的失效目录和功能描述。

基线证据：前端 136 文件、772 项通过；Rust 工作区 534 项通过、8 项忽略；
生产 JS 单包 1,591.64 kB。额外本机 debug 用量冒烟扫描 247 个日志耗时 8.50 秒；
它不是 release 性能数据，不得把 debug/release 差异作为优化收益。

## 高层进度

- [x] 复核当前工作区、Belfry 环境与三个开发会话。
- [x] 派发并收到三个有明确文件所有权的原开发任务交付。
- [ ] 进行中：统一接线、审查、追加修复与整合回归、性能/交互验证。
- [ ] 回读 Belfry 完成状态并记录真实交付边界。

## 所有权与任务表

| 会话 | 任务 | 写入范围 | Belfry 任务号 | 状态 |
| --- | --- | --- | --- | --- |
| 开发1 | [统计优化](developer-1.md) | `src-tauri/src/usage/**`、`src/usage/insights/**`，本目录 `developer-1-*` | `seqqe10g` / `3vgn7ctr` | 原任务 done；大日志兼容性追加已派发 |
| 开发2 | [终端优化](developer-2.md) | `src/terminal/**`、`src-tauri/src/terminal/**`，本目录 `developer-2-*` | `md22evwe` / `w4r7c0gn` | 原任务 done；交付脚本与工作区只读交叉审查中 |
| 开发3 | [前端与交付](developer-3.md) | `src/components/AppOverlays.tsx`、`src/workspace/**`、新增按需加载辅助组件/测试；`.github/workflows/**`、两个 README；本目录 `developer-3-*` | `j1m2kjgx` / `ygx9mabc` | 原任务 done；生产包失败恢复追加已派发 |
| 项目经理 | 根入口接线与整合 | `src-tauri/src/lib.rs`、本文件、`scripts/plugin-tests/dropdown-ui.case.mjs` 及其独立 fixture、必要的整合验证产物 | — | 三项接线完成，整合审查中 |

## 协作边界

- 三个会话共享当前目录与分支；不同文件所有权代替 worktree，禁止互相覆盖或还原修改。
- 不提交、推送、改写历史、删除用户文件或终止正式 Belfry / 用户进程。
- 仅新增必要文件，不增加依赖，不修改锁文件、持久化格式或已有公共类型的语义。
- 与目标直接相关的向后兼容 IPC 扩展可以在任务范围内实现，必须写清输入、取消/断线行为和测试；
  `src-tauri/src/lib.rs` 的 state/command 注册只由项目经理整合。
- CI 仅由开发3编辑，全部变更最终统一审查；不得触发远程发布或假报 Windows 已运行。
- 越界需求先记录到各自结果文件并上报，不能因其他会话修改导致测试失败就还原其代码。
- `belfry done` 是任务完成信号，不能用 peers 的 idle 代替。收到 done 后仍须核查实际差异与验证证据。

## 总体验证

- `pnpm test`、`pnpm build`、`cargo test --workspace --offline --locked` 和 `git diff --check`。
- 定向运行 Node 插件回归，检查新增 CI 是否真的包含这些测试，而非仅构建。
- 用量：冷/热查询、续写、轮转、去重、取消；验证统计结果与原算法相符。
- 终端：大量输出、输入响应、断开与重连、旧连接确认隔离、后台任务继续运行。
- 前端：构建拆包证据与可选面板打开/关闭/加载失败反馈；工作区持久化和焦点恢复不回退。
- 对照 `docs/cli-manager-implementation.md` 保留既有原生/Windows 待验收项；
  新 CI 文件存在或本机测试通过不构成 Windows 实机、PR 远程运行或发布成功证据。

## 结果记录

2026-09-14 完成三次 `belfry send`，均退出 0。
这些回执仅证明进入投递队列，尚不证明已开工或完成。待 `belfry wait` 回读与代码验证后更新。
首次等待 `seqqe10g` 30 秒超时，状态为“已送到对方终端，还没交差”；继续跟踪原任务，不重复派发。
等待 `md22evwe` 同样确认已送达、未交差；peers 显示三名开发均在处理对应任务。
本机磁盘当前剩余约 2.4 GiB，优先复用现有构建缓存，不同时生成多份桌面产物。
已询问可用 Windows 验证环境；没有实际运行证据前保持对应验收项未完成。
开发2提供 ack 接线清单后，项目经理已检查实际函数并注册 `terminal_ack_output`。
已准备独立生产包面板检查 `tmp/system-optimization-qa/panel-smoke.mjs`，语法检查通过，
待最终构建后检查按需加载、面板开关和终端 DOM/会话创建次数；未宣称界面验证已通过。
开发1实际 export / commands 已落盘后，项目经理已注册 `UsageAnalyticsState` 与 `usage_cancel_analytics`。
开发3报告 Node 插件基线 158 项中 3 项 dropdown UI 失败、4 项上游 fixture 缺失；
项目经理接手失败的测试/fixture 排查，CI 保留实际失败，不改成静默跳过。
独立 Chrome 验证发现同 URL 的 ESM 导入首次 503 后，第二次导入仍拒绝且只有一次网络请求；
面板恢复需覆盖浏览器模块缓存。向开发3追加复核时命令因忙碌被拒绝，未生成新任务号，
待原任务交差再派发，不能将此建议视为已送达。
项目经理已修复 dropdown 浏览器回归的三个失效断言：外部点击使用未被弹层覆盖的头部；
未知枚举按当前 Select DOM 检查且保留原始值；窄视口验证滚动外框并通过搜索选择末项。
未修改产品控件。实际执行 `BELFRY_REQUIRE_BROWSER_TESTS=1 node --test scripts/plugin-tests/dropdown-ui.case.mjs`，
4 项通过、0 失败、0 跳过，退出 0；整合后仍需完整插件回归。
开发3随后在所有权范围内新增 `retryImport.ts`，实现同源模块 URL 重试标记；
该实现在途，仍需生产构建与真实浏览器验证，不能以重建 React.lazy 的单元测试替代。
已用 `belfry wait` 确认 `seqqe10g` 和 `j1m2kjgx` 为 done；交付文件已回读，开发2尚未交差。
开发1初版同模式合成 247 日志的热查询正文/解析均为 0；代码审查发现单文件索引上限和累计重放上限
会拒绝旧版可流式统计的大日志，已追加 `3vgn7ctr` 要求可取消流式回退及兼容性回归。
开发3初版前端 808 项、Node 必跑 167 项和 Rust 576 项通过为开发报告；独立整合验证尚未完成。
已要求开发3把 JS/CSS/共享依赖失败恢复提升为生产构建浏览器证据，覆盖 Vite/ESM 缓存，而非只测开发服务器。
已用 `belfry wait` 确认开发2原任务 `md22evwe` 为 done；其 64 MiB 真实 xterm 解析器压力与 TCP/回放模拟
分别记录“缓存足够时保序”和“回放溢出时可见 gap”，没有声称超过 2 MiB 的所有后台数据都被保留。
另派 `w4r7c0gn` 请开发2只读审查 CI/发布前置与工作区恢复，不编辑开发3所有权文件。
项目经理独立运行生产包 `panel-smoke.mjs 1080`，设置/历史/用量首开产生新的生产 JS 请求，
开关前后三个 xterm DOM 均保留、terminal_create 次数不增加，无未处理错误与横向溢出。
首次检查因临时旧 fixture 的 Shell profile 为 `zsh` 而少恢复一个会话；只在本轮 QA 存档改为合法的
`shell:zsh` 后通过，未修改产品代码。证据为 `tmp/system-optimization-qa/panel-smoke-1080.json` 与截图。

## 2026-09-15 接续整合

- [x] 回读分支差异、三份交付报告、接线说明与原生验收接续；保留所有已有修改。
- [ ] 进行中：交叉审查最终实现并执行独立整合回归。
- [ ] 收齐当前 Belfry 的完成回执，修复审查发现并更新验收边界。
- [ ] 在本机可用环境内继续原生验收；缺少 Windows/远程环境的项目保持待验收。

本次实际执行旧追加任务 `3vgn7ctr`、`w4r7c0gn`、`ygx9mabc` 的 `belfry wait --timeout 1`，
三者均返回“没有编号的任务”、退出 1；旧报告存在不等于当前协作系统可回读 done。
开发1、开发3现已空闲，重新派发只读交叉审查以确认最终代码和新的完成回执；
开发2仍在工作，不以 peers 的忙闲推断其原审查已经完成。
新任务：开发1只读审查终端 `wtneqrxe`；开发3只读审查统计 `9tjhehn9`。
两次 `belfry send` 均退出 0，仅代表送入队列；后续以对应 `wait` 返回的 done/fail 为准。
当前可用磁盘约 2.4 GiB，复用现有缓存并避免并发桌面构建。

## 2026-09-15 发布接续：v0.21.0

用户明确要求推送并发布新版本，本节记录本次发布的验证和进度；此前不提交、不推送的派发边界
已由本次授权覆盖。旧 Belfry 任务回执和剩余桌面验收仍按前文事实保留，不以发布动作补记完成。

- [x] 核对现有两个未推送提交、全部系统优化差异、交叉审查及追加修复报告。
- [x] 独立复核发布资产 URL 绑定、sidecar 锁文件保护、Node 20 兼容性及用量消费者交接修复。
- [x] 同步 package、Tauri、Cargo manifest/lock 的版本为 0.21.0，并补充用户更新日志。
- [x] 本机最终回归与生产构建。
- [ ] 推送当前分支，并确认 GitHub macOS / Windows 检查结果。
- [ ] 推送 v0.21.0 标签，核对三平台安装包、签名和更新清单后公开 Release。

本次实跑（macOS arm64，Node 24.11.1 / Node 20.19.0，全部命令退出 0）：

| 验证 | 结果 | 日志 |
| --- | --- | --- |
| `pnpm test` | 144 文件，816 通过 | `/tmp/belfry-v0.21.0-frontend.log` |
| `pnpm build` | 类型检查、生产构建通过；主包 1238.54 kB，保留超过 500 kB 的提示 | `/tmp/belfry-v0.21.0-build.log` |
| `TAURI_ENV_DEBUG=true node scripts/bundle-cli.mjs` | 真实 host sidecar 构建通过 | `/tmp/belfry-v0.21.0-sidecar.log` |
| `cargo test --workspace --offline --locked`（src-tauri） | 合计 597 通过、10 忽略、0 失败 | `/tmp/belfry-v0.21.0-rust.log` |
| `node .github/workflows/verify-plugins.mjs` | 171 通过、0 失败、0 跳过 | `/tmp/belfry-v0.21.0-plugins.log` |
| Node 发布资产与 sidecar 回归 | 11 通过、0 失败、0 跳过 | `/tmp/belfry-v0.21.0-release-gates.log` |
| Node 20 发布资产、sidecar 与生产面板回归 | 15 通过、0 失败、0 跳过 | `/tmp/belfry-v0.21.0-node20.log` |
| 两个 workflow YAML 解析、`git diff --check` | 通过 | 本次命令输出 |

Rust 默认忽略项和未提供上游 fixture 的 4 项 PI 互操作不计入通过数；Windows 原生交互、
Hook / Worktree 剩余桌面步骤仍以实施记录为准。远程检查与发布结果将在实际运行后记录。

## 2026-09-15 CI 回归修复

已核对分支检查 [34915032782](https://github.com/ChengSoon/belfry-desktop/actions/runs/34915032782)、
PR 检查 [34916470206](https://github.com/ChengSoon/belfry-desktop/actions/runs/34916470206) 和合并后
主分支检查 [34916486517](https://github.com/ChengSoon/belfry-desktop/actions/runs/34916486517)。
主分支 macOS 检查通过，Windows 检查仍失败；本节记录的是待推送修复的本机验证。

- Worktree 测试继承 Git 的 `core.autocrlf`，Windows 检出内容为 CRLF，与 LF 断言不同。
  临时测试仓库显式设置 `core.autocrlf=false`；本机注入独立的 `autocrlf=true` 配置，先复现失败再验证修复。
- 身份注入和 PATH 测试写死 Unix 路径及冒号分隔。改用平台匹配的 URI、路径和 `join_paths`，
  并校验原 PATH 的全部条目、空格和顺序。
- 插件重启测试在服务启动后 30ms 自动退出，可能抢在 `load` 握手完成前发生。
  人为延迟启动可复现 `PLUGIN_EXITED`；改为握手完成后终止测试自己的 worker，验证重启后再退出、禁用及取消待执行重启。
- PR 检查额外暴露同长度日志连续改写的时间戳假设：缓存依赖文件身份、大小和时间戳，
  连续写入未必推进文件时钟刻度。测试显式递增修改时间，验证可观测元数据变化时的缓存失效；缓存策略保持原状。

改动限于五处测试及本文记录。本机实跑结果如下，各通过项命令均退出 0：

| 验证 | 结果 | 日志 |
| --- | --- | --- |
| `pnpm test` | 144 文件、816 通过 | `/tmp/belfry-ci-frontend.log` |
| `pnpm build` | 类型检查、生产构建通过；保留原有大 chunk 提示 | `/tmp/belfry-ci-build.log` |
| Rust workspace，`--offline --locked`，独立 Git 配置设 `autocrlf=true` | 597 通过、10 原有忽略、0 失败 | `/tmp/belfry-ci-rust-after.log` |
| 完整插件和真实浏览器回归 | 171 通过、0 失败、0 跳过 | `/tmp/belfry-ci-plugins-after.log` |
| Node 20 发布资产、sidecar、生命周期和生产面板回归 | 19 通过、0 失败、0 跳过 | `/tmp/belfry-ci-node20.log` |
| 生命周期套件连续重复 10 轮 | 40 次测试通过 | `/tmp/belfry-ci-lifecycle-repeat.log` |
| PATH 定向测试，临时目录分别不放/放入真实 CLI | 4 次调用通过，CLI 存在时的断言实际执行、未跳过 | 本次命令输出 |

Windows 目标的 `cargo check --workspace --tests --target x86_64-pc-windows-msvc --offline --locked`
（`BELFRY_CROSS_CHECK=1`）退出 101：本机缺少 Windows SDK，`ring` 的 C 编译找不到 `assert.h`；
日志为 `/tmp/belfry-ci-windows-check.log`，不计为通过。用户已授权提交、推送本次修复并复跑 CI；
Windows 原生验证以修复提交的远程检查结果为准，后续发布仍待完成。
