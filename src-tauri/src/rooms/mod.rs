//! 协作房间：常驻的会话编组。
//!
//! 房间不碰传输：派发照样落进 `TaskBoard`、经 Prompt 队列投进成员终端，
//! 成员照样敲 `belfry done` 交差。这一层做的只有三件事——
//!
//! 1. 把房间、成员、讨论、决定、任务与交付状态持久化到 `rooms.json`；
//! 2. 把 TaskBoard 的状态**对账**（reconcile）回每条投递并追加系统消息，
//!    界面从不自己猜状态；
//! 3. 明确区分「已送达」「对方交差」与「结果未知」：应用重启后旧任务编号
//!    查不到，一律回写成 Unknown，不假装成功。

pub mod commands;
mod store;

pub use store::RoomStore;

#[cfg(test)]
#[path = "store_test.rs"]
mod store_test;
