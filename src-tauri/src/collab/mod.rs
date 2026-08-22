//! 多 Agent 协作。
//!
//! 第一层是共享上下文：会话之间互通的笔记、片段与产物。落在项目里的
//! `.belfry/context/`，因为读者不只是 UI，更是 Agent 自己。
//!
//! 第二层是协作总线：给每条 Agent 会话发一张身份牌，让它能通过控制 CLI
//! 读写共享上下文，并（后续）对别的会话派活。
//!
//! 这一层对「是哪个 Agent」保持无知——不比较 agent 取值，只认能力。
//! 新接一个 CLI 进来时，这里不该有任何改动。

pub mod commands;
mod contracts;
mod identity;
mod store;

pub use identity::SessionIdentities;
