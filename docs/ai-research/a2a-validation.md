# A2A 1.0 接入验收记录

日期：2026-11-15。T13 验收完成；最终代码的前端、Rust、Node、i18n、生产构建、必需插件 / 浏览器与文档检查均已通过，具体命令与证据如下。目标仓库为 `belfry-win`，工作树基于 `7140b6013440d27cb89082636bb328ff844ed07c`。改动随 1.0.10 发布。

本页完整检查对应 T13 首期交付的代码。用户随后发现客户端仍读取旧协作 Skill，T16 / T17 已补共享来源迁移、房间指引和使用说明；追加改动的迁移 5 项、收件箱 32 项及实际双 embedded MCP / HTTP 1 项通过，见 [原生残留核查](a2a-skill-residual-native.md) 与 [工具目录核查](a2a-skill-residual-tools.md)。没有再次执行首期全套检查，也没有迁移真实用户 Skill 或验证截图 Agent 的真实模型工具调用。

后续源码复核、修复与回归记录见 [A2A 复核问题修复记录](a2a-review-fixes.md)（2026-11-16）。

## 用户可用范围

同一项目中已读取 MCP 工具目录的 Codex PTY / Claude PTY 可以自动发现彼此，通过 A2A 1.0 HTTP 派活、续写、查询和请求取消。接收方用 `A2AReportTask` 显式报告进展、缺少输入、完成或失败。房间、任务板、收件箱继续保存业务状态、角色和任务代次；终端闲置不完成任务。外部 Agent 在设置中按兼容 Card 配置，支持匿名、静态 Bearer / Header API-key。

内置中英 Belfry 协作 Skill、启动安装和安装按钮已移除。新协作使用可发现工具和任务提示，人工兼容 CLI 保留。启动迁移只处理已知哈希的原样副本，保护修改副本、其他 Skills 与符号链接。使用入口见 [完整指南](a2a-guide.md) 和 [网站说明](../../website/docs/a2a.md)。

协议按官方 [v1.0.1 的 a2a.proto](https://raw.githubusercontent.com/a2aproject/A2A/v1.0.1/specification/a2a.proto) 核查，软件补丁标签与 wire `1.0` 分开记录；官方来源与访问日期见 [技术核查](technology-scan.md)。

## 链路与证据

| 范围 | 可复核来源 | 证明的行为 |
| --- | --- | --- |
| 外部原生客户端 | [HTTP 协议测试](../../src-tauri/src/a2a/tests/protocol.rs)、[生命周期](../../src-tauri/src/a2a/tests/lifecycle.rs)、[凭据](../../src-tauri/src/a2a/tests/vault.rs) | Card / interface / tenant、静态认证、版本和错误、Message / Task、产物、续写、真实取消与请求停止，已知凭据在公开成功响应和错误中的处理 |
| 外部 embedded MCP | [原生桥接测试](../../src-tauri/src/a2a/tests/bridge.rs) | 实际宿主嵌入 Node MCP → 正式 typed Rust 路由 → loopback HTTP 服务 |
| 本地双 Agent | [embedded 双会话](../../src-tauri/src/a2a/local/tests/bridge.rs)、[原生生命周期](../../src-tauri/src/a2a/local/tests/lifecycle.rs) | 实际 embedded MCP 发现 → 同一 Rust HTTP 客户端 → 本地 Gateway → 权威投递 / 任务 → 接收方工具报告 → Sender GetTask；输入续写与产物、首次绑定恢复、空闲保持未完成 |
| 房间与代次 | [原生房间测试](../../src-tauri/src/a2a/local/tests/rooms.rs) | 角色、依赖、自领、简报部分更新 / 清除与幂等、失败保持业务任务未完成、重开后旧报告拒绝、删除房间不破坏其他任务预览 |
| 跨项目 HTTP | `local_a2a_real_http_rejects_cross_project_access_without_business_writes`，位于上述生命周期文件 | 两个 canonical 项目、四个就绪实例先验证自己的有效 bearer；直接跨项目请求 Card 404，普通 / 房间 Send、已有 Task 的 Get / Cancel 返回 -32001；TaskBoard、房间任务 / outbox、Inbox 快照及 Gateway 任务数保持一致 |
| Node 工具契约 | [五个客户端工具](../../scripts/plugin-tests/a2a-tools.case.mjs)、[十个本地工具](../../scripts/plugin-tests/a2a-local-tools.case.mjs) | 实际 Node MCP transport + 合成原生回调；参数白名单、内部操作 ID、会话与代次、目录恢复、结构化错误、取消后的未知结果 |
| 独立 HTTP fixture | [协议 fixture 测试](../../scripts/plugin-tests/a2a-http.case.mjs) | 精确 A2A 1.0 wire、默认 / false 等待、history 边界、输入和取消；独立于宿主客户端实现 |
| 用户界面 | [A2A 生产面板](../../src/components/lazy/testing/a2a-connections.case.mjs)、[房间 / 收件箱](../../src/components/lazy/testing/a2a-room-reports.case.mjs)、[迁移诊断](../../src/components/lazy/testing/setup-terminal-i18n.case.mjs) | 生产 dist 和生产 React 组件，使用合成 native IPC；设置 / 就绪、显式来源与问题 / 产物、旧代次隔离、移除安装按钮、英文小窗口布局 |
| 迁移 | [原生迁移测试](../../src-tauri/src/setup/migration.rs) | 临时目录中的原样删除、重复执行、自定义 / 相邻文件保护、文件和目录符号链接、目录范围；生产指纹已由统筹与 Git 中原内置中英文件独立核对 |

T11 最终 `a2a` 名称过滤集为 42 项通过：19 本地、18 外部、4 迁移、1 票据 / PTY 授权。受影响原生过滤集与命令见 [本地契约末尾](a2a-local-contract.md)。过滤集之间存在重叠，不相加为独立测试数量。

本地协议提示包含报告工具、句柄和代次，原生投递测试检查不需要 `belfry done` / `belfry room` 命令。完成、失败和提问由受信任调用实例的显式操作驱动。停止 MCP / HTTP 请求与 `CancelTask` 区分；提交意图前的 direct 排队任务可撤回，已提交 / 可能提交 / 执行中的任务和房间任务可以明确拒绝取消。

内置 Send 工具固定请求 `returnImmediately:true`，然后由 GetTask 轮询；标准 Gateway HTTP 请求仍按缺省 / false 等待到终态或输入中断。模型不能自填 URL、凭据、项目、ticket、所有者或操作 ID。Sender 的 taskHandle 与 Recipient 的 reportHandle 用途不同；跨实例或旧代次不能复用。

界面按完整 TaskRef 匹配，保留业务状态并单独显示协议状态。快照最多 128 项，说明预览 4096 字、每产物 512 字，截断有标记；完整内容保留在任务 / 房间 / 收件箱或 Agent 任务工具中。刷新错误显示预览可能过期。前端回归覆盖项目切换、旧代次、未知状态、截断与文本转义。

## T13 完整检查

环境：macOS 26.6.2 arm64、Node 24.11.1、pnpm 10.34.4、Rust / Cargo 1.97.1；另有本机 Node 20.19.0 用于 CI 指定的兼容回归。复用现有依赖，没有修改依赖或锁文件。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm test` | 207 文件、1385 测试通过 |
| `pnpm check:i18n` | 3802 条 / 语言，0 legacy strings |
| `node scripts/export-backend-i18n.mjs --check` | 通过 |
| `node scripts/sync-backend-i18n.mjs --check` | 985 条同步目录一致，通过 |
| `node --test scripts/i18n-checks.case.mjs .github/workflows/check-shell.case.mjs .github/workflows/plugin-suite.case.mjs scripts/backend-i18n.test.mjs` | 24 通过，1 个 Windows 专属实机 PowerShell 对比用例按原规则跳过 |
| `pnpm build` | 通过，类型检查与生产 dist 完成 |
| `node scripts/build-playwriter-plugin.mjs`、`node --test --test-concurrency=1 scripts/playwriter-tests/plugin.case.mjs` | 构建通过，5 测试通过、0 跳过 |
| `TAURI_ENV_DEBUG=true node scripts/bundle-cli.mjs` | 通过；与 CI 一致准备 debug sidecar |
| `cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked` | 最终 Node 截止时间修正后重新构建嵌入资产，1071 通过、0 失败，14 项原有 opt-in / 手动 / 基准测试忽略；含 A2A 42 项 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked room_project_native -- --nocapture` | 2 通过；CI 单独要求的 cwd 证据，与 workspace 有重叠 |
| `cargo build --manifest-path src-tauri/Cargo.toml --locked -p belfry-desktop` | 通过 |
| `python3 scripts/test-terminal-daemon.py src-tauri/target/debug/belfry-desktop` | 通过；认证 / 租约 / 重连 / 滚动升级 / 关闭验证 |
| `python3 scripts/test-room-agent-protocol.py src-tauri/target/debug/belfry-desktop` | 六类 fake CLI 通过；人工 CLI 兼容进程链路 |
| `node .github/workflows/verify-plugins.mjs` | 最终 85 个必跑文件、401 测试全部通过，0 失败 / 取消 / 跳过 / todo；完整 TAP，657.588 秒，原总预算 2100 秒 |
| `node --test --test-concurrency=1 scripts/plugin-tests/mcp-lifecycle.case.mjs scripts/plugin-tests/mcp.case.mjs` | 夹具修正后 8 通过、0 失败 / 跳过，保留撤权、隐私与取消断言 |
| `node --test --test-concurrency=1 scripts/plugin-tests/a2a-local-tools.case.mjs scripts/plugin-tests/a2a-tools.case.mjs scripts/plugin-tests/mcp-lifecycle.case.mjs scripts/plugin-tests/mcp.case.mjs` | 总截止时间修正后 30 通过、0 失败 / 跳过；本地工具 14 项、外部工具 8 项、原 MCP 回归 8 项 |
| Node 20.19.0 下 `node --test --test-concurrency=1 scripts/plugin-tests/a2a-local-tools.case.mjs scripts/plugin-tests/mcp-lifecycle.case.mjs scripts/plugin-tests/mcp.case.mjs` | 22 通过、0 失败 / 跳过，覆盖新截止时间与原撤权 / 取消边界 |
| `node --test --test-concurrency=1 .github/workflows/release-assets.case.mjs scripts/bundle-cli.case.mjs` | Node 24 下 22 通过、0 跳过 |
| Node 20.19.0 下 `node --test --test-concurrency=1 .github/workflows/release-assets.case.mjs scripts/bundle-cli.case.mjs src/components/lazy/testing/production-panels.case.mjs` | CI 指定兼容回归 26 通过、0 失败 / 跳过；浏览器必需 |
| `pnpm --dir website build` | 中文、英文网站均生成成功，退出 0 |
| `git diff --check`、文档本地链接 / 围栏 / 换行检查 | 差异检查通过；14 个 Markdown 文件、82 个本地链接，0 问题 |

Node / Rust 定向阶段与完整集合之间存在重叠；表中各行按实际命令记录，不相加为独立测试总数。

完整日志与每条命令的退出码、时间保存在 `/tmp/belfry-a2a-t13/`。最终生产浏览器证据与原始报告位于 `/tmp/belfry-a2a-t13-panels/final/`，Node 20 兼容证据位于 `/tmp/belfry-a2a-t13-panels/node20/`。最终 TAP 与报告另存 `plugins-browser-final.tap`、`plugins-browser-final-summary.json`；报告确认 85 文件、401 项通过、完整结束且无 issues。截图已复核设置编辑、显式输入 / 产物、房间 / 收件箱与 Skill 迁移诊断。

前端生产构建保留超过 500 kB 的 chunk 体积提示；Playwriter 打包的 `abbrev` / `nopt` 依赖报告 Node engine 警告；网站提示未提供 blog 目录。构建退出码均为 0，Playwriter 实际宿主回归通过，网站两个语言的静态文件均生成；本记录按实际 Node 24.11.1 环境描述结果。

首次 Rust workspace 构建因磁盘不足（ENOSPC）停止。执行 `cargo clean --manifest-path src-tauri/Cargo.toml --profile dev -p belfry-desktop` 清理本仓库可重建的 desktop dev 缓存后恢复约 25 GiB 空间；源码、依赖和锁文件没有因此修改。下一次完整运行发现 i18n 宏测试仍引用旧协作提示，已同步当前 A2A 模板与英文期望并保留参数重排断言；宏定向 1 项和最后完整 workspace 均通过。三次日志分别保留为 `rust-workspace.log`、`rust-workspace-retry.log`、`rust-workspace-final.log`，已通过的无关检查没有重复。

首轮插件 / 浏览器检查完整结束为 397 项、395 通过、2 失败、0 跳过。两项 MCP 撤权夹具的原错为 `Cannot read properties of undefined (reading 'isError')`。旧平台回调对任何 API 都发送“工具已开始”信号并暂停响应；新增 `tools/list` 的 `a2a.localReady` 先触发该信号、等待 60 秒，随后测试在真正工具尚未开始前撤权，收到认证错误而非工具结果。仅将两撤权夹具和相邻取消夹具的暂停 / 就绪信号限定到工具实际调用的 `ui.showToast`；原撤权、私有结果不可泄漏、取消信号与连接保留断言和超时均不变。受影响两文件 8 项通过，日志为 `mcp-revocation.log`。首轮日志、TAP、报告保留为 `plugins-browser.log`、`plugins-browser.tap`、`plugins-browser-summary.json`，原截图保留在 `/tmp/belfry-a2a-t13-panels/`。

该失败同时暴露 `localAdapterReady` 原先只限制重试间隔、没有限制单次宿主等待。T12 已补上单一 2500 ms 总截止时间，包含所有平台等待与暂停，退出时清理 timer / listener；保留原 `activeContext`，撤销或请求取消仍拒绝目录。新增真实 Node MCP 的悬停、累计重试耗时、晚响应、撤销与取消后有效查询恢复回归；本地工具由 10 项增至 14 项，与外部工具及原 MCP 回归合计 30 项通过，Node 20 下受影响本地 / 原 MCP 22 项也通过。没有增加业务写入重试或放宽原超时，日志为 `a2a-readiness-node.log` 与 `node20-a2a-readiness.log`。随后完整 Rust workspace 以新 Node 嵌入资产再验，1071 项通过、含 A2A 42 项，日志为 `rust-workspace-deadline.log`；新 desktop debug 构建、daemon 与六类 fake CLI 人工协议再验均通过。

第二轮完整插件 / 浏览器检查在修正后的最终代码上执行，仍按 85 文件、串行、35 分钟总预算与 5 分钟单项预算运行；新增四项回归后共 401 项，全部通过、0 跳过。没有替换生产 dist、放宽浏览器请求期限或重试失败断言。Node 20 的 CI 指定 26 项随后通过，日志为 `node20-compat.log`。

Rust 默认忽略的 14 项均来自已有规则：4 项启动 / 用量基准、4 项需要真实 CLI 或指定 native fixture 的 opt-in、5 项本机历史 / 配置 / 用量手动报告、1 项可能弹出 OS 凭据提示的 opt-in。完整名称与原因在最后 workspace 日志中保留；这些项不计作通过。

## 可复现试用

按 [指南](a2a-guide.md) 构建并运行新的桌面宿主，重开两条同项目 Codex PTY / Claude PTY，会话实际读取新工具后查看设置中的本地 Agent。向 Sender 提出派活请求；Recipient 从本人任务工具读取完整上下文，报告 inputRequired，Sender 用原句柄补充输入，Recipient 报告 completed 和文本产物，Sender 查询到完成。房间中的派活、自领和重开使用同一任务板规则。

无需新模型凭据的外部协议试用：在仓库根目录运行 `node scripts/plugin-tests/fixtures/a2a-server.mjs --port 17777`，设置 Card 为 `http://127.0.0.1:17777/.well-known/agent-card.json`。匿名检测 / 保存后使用指南中的即时消息、输入补充、结果和取消场景；静态认证演示值是公开的 `fixture-key`，一次只启动一种模式。自动化 HTTP 测试不启动模型。

## 已知验证边界

原生与 embedded 测试使用真实 HTTP、正式 Node / Rust 模块、临时权威存储和合成的后认证 Agent / PTY 快照；投递字节通过受控闸门回调验证。它们没有启动真实 CLI 模型自主执行任务。浏览器使用合成 native IPC，不代表真实用户数据的桌面 UI 验收。

未调用真实 LLM 或真实远端 Agent，未迁移真实用户目录。`BELFRY_CODEX_NATIVE=1` 隔离路径与其他 CLI 没有已验证的自动适配器；只承诺 MCP 注入的 Codex PTY / Claude PTY 路径。首期本地 Gateway 只监听 loopback，文本 / JSON-RPC 轮询；SSE、push、OAuth / OIDC / mTLS、Card 签名和跨机器公开本地会话不在范围内。

Windows / Linux 原生打包和 Windows 安装脚本尚未在本机执行。4 项固定上游 PI 互操作在缺少 `BELFRY_PI_SOURCE` 时按仓库原规则另行验收，不计作通过；仓库自带必跑插件 / 浏览器用例不得因此跳过。
