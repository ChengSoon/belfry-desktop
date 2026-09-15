# CM-04 项目级 Provider 隔离 Implementation Plan

> **For agentic workers:** 使用 `superpowers:executing-plans` 按任务执行；沿用本轮开发授权，不提交或推送。

**Goal:** 当前项目可分别为 Codex、Claude 选择已保存的 Provider，或跟随全局，并且并行项目互不改写配置。

**Architecture:** Belfry 私有存储只记录规范化项目路径、Agent 和 Provider ID。启动时生成独立的参数/环境覆盖：Codex 使用 `-c` 与专属密钥环境变量；Claude 使用每个进程独有的 `--settings` 快照。快照由 PTY 生命周期持有，退出后清理。

**Tech Stack:** 现有 React、Tauri、Rust、serde_json、toml_edit 和 portable-pty，不增加依赖。

**Spec:** [CM-04 范围与验收](../../cli-manager-feature-backlog.md)。

## 约束与设计取舍

- 保留原全局 Provider 编辑器；在设置中增加独立的“项目 Provider”页，明确显示当前项目及生效来源。
- 项目仅选择已保存的第三方 Provider；“跟随全局”完整恢复 CLI 的原配置与登录态。
- 不写 `.claude`、`.codex` 等仓库配置，不修改全局配置或 auth.json，不通过 CLI 参数传密钥。
- 私有启动覆盖不接受前端反序列化；前端只保存 Provider ID，启动准备在 Rust 内完成。
- 已删除的 Provider 必须报错，不能悄悄改走另一条路由；新会话及恢复会话均执行相同解析。
- 两种 CLI 的覆盖都只影响新建/恢复的进程，已启动进程继续使用启动时快照。
- 命令参数使用数组和 TOML 序列化；环境冲突只显示变量名，不显示值。
- CLI 配置/凭据和共享启动接线按本轮功能授权实施，验证重点为进程隔离与无全局写入。
- 新文件不超过 300 行，新函数不超过 50 行；审查按现有会话执行，不冒充独立子代理 review。

## Task 1: 项目选择与启动覆盖

Files: `src-tauri/src/provider/project/` 的 contracts、storage、launch、snapshot、service、tests；新增 `terminal/overlay.rs`；在 terminal commands/native 和 provider/lib 接线。

Interfaces:

```rust
ProjectProviderSelection { root_path: String, kind: AgentKind, provider_id: Option<String> }
ProjectProviderReport { root_path: String, agents: Vec<ProjectAgentProvider>, env_conflicts: Vec<EnvConflict> }
LaunchOverlay { arguments: Vec<String>, environment: HashMap<String, String>, unset: Vec<String> }
```

- [x] 先验证 A/B 项目、Codex/Claude 的选择独立，移除覆盖不影响其他项目，损坏/新版本存档不可覆盖。
- [x] 验证两个启动配置使用不同 URL/密钥，密钥不在参数和项目存档里，继承的冲突变量被处理。
- [x] 验证 Claude 快照独立且私有，随会话生命周期清理；保留项目原文件和 CLI 全局配置。
- [x] 实现原子选择存储、只含显示字段的查询报告、缺失 Provider 报错及启动接线。

## Task 2: 项目设置页

Files: `src/provider/project/` 的 contracts、api、model、useProjectProviders、ProjectProviderSection、CSS 和测试；最小接入 SettingsPanel、AppOverlays。

- [x] 展示当前项目路径、两个 Agent 的选择与生效来源，空项目/缺失 Provider/请求失败均可见。
- [x] 显示“只影响后续启动”及环境冲突说明；保存失败保持旧选择，切换项目隔离旧响应。
- [x] 用实际组件测试验证显示字段、缺失状态和不展示凭据。

## Task 3: 审查与验收

- [x] 运行 Rust/前端定向测试，检查所有覆盖路径及敏感数据存放位置。
- [x] 使用临时目录和本机模拟端点验证已安装 CLI 的参数/设置优先级，不调用真实模型服务。
- [x] 完成全量回归、构建及桌面设置/重启回读检查。
- [x] 验收通过后勾选小清新待办 CM-04，重开回读并同步总实施记录。

验证记录：

- 4 项核心行为测试先失败后通过；补充了并发保存、缺失凭据、凭据不进入报告、前端不能注入私有启动参数的测试。
- 前端完整回归：87 个文件、572 项通过；Rust：383 项单元测试、1 项集成测试通过。默认忽略项为原有 4 项加手动 CLI smoke 1 项。
- 手动 CLI smoke 单独执行通过：`cargo test --manifest-path src-tauri/Cargo.toml provider::project::cli_smoke --lib -- --ignored --nocapture`。
- Codex 0.154.0 与 Claude Code 2.1.201 共 4 条并行进程，在本机模拟端点验证路由、密钥、模型，且预置全局/项目冲突配置未被改写。
- 测试启动必须复用 `agent::user_command_path()`；从 `src-tauri` 目录直接启动时的默认 Node 20 不支持当前 Claude CLI，应用实际登录 Shell PATH 使用 Node 24。
- 日志：`/tmp/belfry-cm04-final-frontend.log`、`/tmp/belfry-cm04-final-rust.log`、`/tmp/belfry-cm04-cli-smoke.log`。
- 桌面验收：临时项目的两个 Provider 覆盖在 QA 重启后保留；另一项目保持跟随全局；取消覆盖正确还原。三个全局配置/凭据文件哈希未变。
- 待办重开回读：CM-04 已完成，剩余 13 项，共 16 项。当前平台为 macOS，未声称 Windows 实机通过。
