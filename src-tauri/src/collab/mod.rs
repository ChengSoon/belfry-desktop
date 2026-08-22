//! 多 Agent 协作。
//!
//! 第一层是共享上下文：会话之间互通的笔记、片段与产物。落在项目里的
//! `.belfry/context/`，因为读者不只是 UI，更是 Agent 自己。
//!
//! 第二层是协作总线：给每条 Agent 会话发一张身份牌，让它能通过控制 CLI
//! 读写共享上下文，并（后续）对别的会话派活。
//!
//! 这一层对「是哪个 Agent」保持无知——不比较也不构造具体 agent 取值，
//! 只认能力。新接一个 CLI 进来时，这里不该有任何改动。

pub mod commands;
pub(crate) mod contracts;
mod identity;
mod registry;
mod server;
pub(crate) mod store;
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
