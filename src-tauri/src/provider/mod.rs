//! Provider 切换：在官方端点与第三方中转之间切换各个 Agent CLI 的路由。
//!
//! 改的是 CLI 自己的配置文件（`~/.claude/settings.json`、`~/.codex/config.toml`），
//! 所以在 Belfry 之外直接敲 `claude` / `codex` 同样生效。
//!
//! 写入一律是**精准字段改写**：只碰 Belfry 明确认领的那几个 key，其余逐字不动。
//! 这些文件里有用户的 hooks、MCP 服务器定义和项目信任记录，整文件覆盖再靠快照
//! 回填的做法（cc-switch 那套）在这里风险太高——回填只要失败一次就是真实损失。

mod claude;
mod codex;
pub mod commands;
mod contracts;
mod envcheck;
mod service;
mod store;
