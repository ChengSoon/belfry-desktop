//! 额度用量监控：扫描本地 Agent 会话日志，汇总每个模型的 token 用量与账号额度。
//!
//! 数据只来自用户机器上已有的会话日志，不调用任何模型 API、不读取凭证，
//! 与"不内置模型服务、不保存 API Key"的产品边界一致。

mod aggregate;
mod claude;
mod codex;
pub mod commands;
mod contracts;
mod roots;
mod scan;
mod service;
mod timestamp;
