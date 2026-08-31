//! 多 Agent 协作总线。
//!
//! 给每条 Agent 会话发一张身份牌（tabId + token，注入进那条 PTY 的环境），
//! 让它能通过控制 CLI 看见同伴、给同伴派活、并在做完时自己声明做完了。
//!
//! 三个原语就够：`peers` 看有谁、`send` 派活、`done` / `fail` 结账。没有中央
//! 调度器，也没有任务 DAG——拆活是 Agent 自己的事，验收是人的事。每个协作方
//! 都是一条肉眼可见的会话，干错了直接切进去说话，不必走状态机。
//!
//! 这一层对「是哪个 Agent」保持无知——不比较也不构造具体 agent 取值，
//! 只认能力。新接一个 CLI 进来时，这里不该有任何改动。

pub mod commands;
mod identity;
mod registry;
mod server;
pub(crate) mod task;

#[cfg(test)]
#[path = "e2e_test.rs"]
mod e2e_test;

pub use identity::SessionIdentities;
pub use registry::SessionRegistry;
pub use server::CollabServer;
pub use task::TaskBoard;

/// 控制 CLI 的接入点，注入进 Agent 会话的环境变量。
///
/// None 表示服务没起来：此时 Agent 拿不到 BELFRY_ENDPOINT，敲 belfry 会
/// 直接被告知连不上，而不是对着一个不存在的地址反复重试。
pub struct CollabEndpoint(pub Option<String>);
