//! 历史会话管理：列出、删除、清空 Codex 与 Claude Code 写在本机的会话日志。
//!
//! 数据来源与 usage 模块相同（`~/.codex/sessions`、`~/.claude/projects`），
//! 这里只关心会话本身的元数据，不解析用量。删除操作严格限制在各自的
//! sessions 根目录内，会话 id 也做了形状校验，避免前端误传路径删到别处。

pub(crate) mod claude;
pub(crate) mod codex;
pub mod commands;
pub(crate) mod contracts;
pub(crate) mod scan;
mod service;
