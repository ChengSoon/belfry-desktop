# Antigravity CLI、OpenCode、Kimi Code 集成

Belfry 支持六种 Agent：Codex、Claude Code、Pi、Antigravity CLI、OpenCode、Kimi Code。新增三种使用各自的原生终端、配置和会话存储。

## 版本与入口

| Agent | 已验证版本 | 可执行文件 | 继续会话 | 自定义 Provider 协议 |
| --- | --- | --- | --- | --- |
| Antigravity CLI | 1.5.3 | `agy` | `--conversation ID` | Gemini API |
| OpenCode | 2.2.6 | `opencode` | `--standalone --session ID` | OpenAI Chat Completions |
| Kimi Code | 2.5.2 | `kimi` | `--session ID` | OpenAI Chat Completions |

在「关于」页安装或升级 CLI，在新会话菜单中启动；官方账号登录在各自 CLI 中完成。旧版 CLI 应先升级，特别是使用不同配置和数据库格式的 OpenCode 1.x、Kimi CLI 1.x。

新增 Agent 需要新版 Belfry 终端后台。应用升级后如果仍复用旧后台，请先保存并结束正在运行的任务，再重启后台服务（也可重启电脑），然后新建 Agent 会话。

Antigravity 使用官方安装脚本和 `agy update`。OpenCode、Kimi Code 的官方 npm 包分别为 `@opencode/cli`、`@moonshot-ai/kimi-code`；已安装的独立发行版使用 `opencode upgrade`、`kimi upgrade --yes`。已有 npm 镜像安装沿用原包与来源。

## 接入的 Belfry 功能

- CLI 检测、安装、更新、环境诊断与内置协作 Skill。
- 项目会话、新建与恢复、后台接驳、分屏、命名工作区、备份恢复、Quick Open。
- 终端输入、拖入文件、任务队列、快捷指令、状态与通知、原生权限交互。
- 历史列表、继续会话、详情、工具调用与文件修改展示、全文搜索、删除与清空。
- 单会话 Token 和工具统计、全局用量分析、模型价格规则。
- 全局与项目 Provider、模型列表、配置预览编辑、环境变量冲突提示。
- 房间成员、任务板、协作消息与回执、Git Diff 行级反馈。
- Belfry 插件工具、Skill、MCP、当前会话上下文和插件模型调用。

OpenCode 每条 Belfry 终端都以 `--standalone` 启动，使 Provider、Hook 和 MCP 身份随各自进程隔离。在 CLI 中切换会话后，后续工具调用使用新的原生身份；旧调用保留开始时的身份。

## 配置与凭据

OpenCode 使用 `providers.belfry` 和 `model`；Kimi 使用 TOML 中的 `providers.belfry`、`models.belfry`、`default_model`。Antigravity 使用 Gemini 模式及 `customModelsConfig.customModels.belfry`。新增 Agent 的自定义 Provider 必须填写实际模型 ID。

切换前保存原选择，恢复时仅移除 Belfry 托管条目。已有同名用户条目会阻止覆盖。JSONC/TOML 中无关的配置与注释保留。全局配置是否持有明文 Key 取决于 CLI 的要求；Belfry 保存的 Provider 凭据继续使用现有凭据存储。

项目 Provider 通过本次启动的参数或环境覆盖生效。OpenCode 的配置覆盖会合并已有插件、权限和 MCP 设置；Kimi 使用内存中的环境模型；Antigravity 使用临时 settings、`GEMINI_API_KEY` 和 `GOOGLE_GEMINI_BASE_URL`。原生历史、登录态和数据目录保持一致。

Antigravity 1.5.3 的 Gemini 模式将 `modelName` 原样用于请求，因此使用真实模型 ID，并通过 `--model Belfry` 选中；Base URL 和 Key 由 Belfry 启动时注入。这两个值在 Belfry 外运行 `agy` 时需要用户自行配置。

## 状态与权限

在「设置 → 会话状态」启用对应 Hook 后重开会话。Hook 观察原生事件，保留 CLI 的权限策略。

- Antigravity `PreToolUse` 必须返回 `{"decision":"allow"}`，表示继续原生权限检查；空对象会使 1.5.3 拒绝工具。`PostInvocation` 只表示模型调用结束，不能当成整轮完成。
- Kimi Hook 不输出正文，避免把 Hook 的输出注入模型上下文。审批请求、审批结果、工具结束、整轮结束分别处理。
- OpenCode 使用 2.2 的公开插件事件和工具 Hook，权限请求与回复按原生请求 ID 配对；子会话及旧会话的迟到结束事件不会覆盖当前会话。
- OpenCode 权限按钮使用高亮颜色及左右方向键；Kimi 的编号选项支持选项间说明文字。无法可靠识别的界面仍可直接在原生终端操作，包括自定义键位和需要额外填写反馈的选择。

## 历史与统计

| Agent | 原生数据来源 |
| --- | --- |
| Antigravity | `~/.gemini/antigravity-cli/conversation_summaries.db` 与 `brain/ID/.system_generated/logs/transcript.jsonl` |
| OpenCode | XDG 数据目录中的 `opencode/opencode.db`，读取 v2 会话、消息和分片表；支持 `OPENCODE_DB` |
| Kimi | `$KIMI_CODE_HOME/sessions/…/state.json` 与 `agents/main/wire.jsonl`；默认 `~/.kimi-code` |

用于详情、搜索、统计和插件上下文的 JSONL 快照位于 `~/.belfry/cache/agent-history/v1/`。缓存按 Agent、原生存储位置和会话 ID 隔离，可从原生数据重建。读取有大小限制、取消检查和目录边界校验；删除操作针对原生存储，同时失效对应缓存。

删除前检查运行中的 Belfry 会话。Kimi 额外遵守原生会话锁并写入索引删除标记；OpenCode 调用绑定本地数据库的官方删除命令；Antigravity 检查忙碌状态，再删除选中会话及其子会话、索引和附件。

统计只使用原生已记录的数据：

- Antigravity 转录可能缺少模型名、缓存写入量或完整 diff；对应字段保持未知。
- Kimi 的每条 `usage.record` 都是增量，包括 `usageScope: session`；不重复累计 `step.end` 中的摘要。
- OpenCode 会话总量包括标题、压缩等辅助请求。缺少模型和逐次时间的余量单独归入未知模型，不替换当前对话模型。
- 本地未提供的套餐额度不会被推算成可用额度。

## 插件与协作

Antigravity 的 Hook/MCP 位于 `~/.gemini/config/`；协作 Skill 安装到它支持的 CLI 专用 skills 目录。Kimi 使用 `config.toml`、`mcp.json` 和 `skills/`；OpenCode 使用配置目录中的 `plugins/belfry-status.js` 和 `skills/`。

MCP 注册只保存桥接程序路径，连接票据从各自终端继承；没有 Belfry 票据时桥接不提供工具。插件上下文通过连接票据、终端、原生 Hook 身份逐层确认，并核对缓存中的会话与项目；不按最近修改时间猜测会话。OpenCode/Antigravity 提供的 MCP 元数据用于交叉校验。插件模型网关分别使用 Chat Completions 和 Gemini 协议。

## 验证

常规回归：

```sh
pnpm test
pnpm build
node scripts/bundle-cli.mjs
cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked
node .github/workflows/verify-plugins.mjs
```

终端后台与六种 Agent 的房间协议回归（先构建桌面后台和 CLI）：

```sh
cargo build --manifest-path src-tauri/Cargo.toml --workspace --locked
python3 scripts/test-terminal-daemon.py src-tauri/target/debug/belfry-desktop
python3 scripts/test-room-agent-protocol.py src-tauri/target/debug/belfry-desktop
```

浏览器回归覆盖六种 Agent 的 Provider 切换、窄窗口历史筛选，以及新增三种 Agent 的新建和恢复会话。上述两项后台脚本使用 macOS 的临时进程环境。

原生 CLI 使用本机模拟 API 和 MCP 工具验证，未调用付费模型。已验证三种 CLI 的请求、工具调用与 Hook，OpenCode/Kimi 的真实 TUI 权限选择、完成事件和未提交草稿，以及三种原生存储副本的读取、缓存与定向删除。`official_cli_store_snapshot_roundtrip` 是需要显式提供临时原生存储副本的可选测试；它拒绝系统临时目录之外的目标。

本轮运行环境为 macOS；Windows 路径、命令与构建分支已实现，Windows 实机交互仍需验证。Antigravity 首次启动的登录和隐私引导由用户在原生 CLI 中完成。

原生接口依据：[Antigravity CLI 文档](https://antigravity.google/docs/cli/overview)、[OpenCode 源码](https://github.com/anomalyco/opencode/tree/caf8d6a554ecd988767c08f1f15508849eff8728)、[Kimi Code 源码](https://github.com/MoonshotAI/kimi-code/tree/eb2035f3cad57cc12d4d5082ec626f7f0ea5f651)。
