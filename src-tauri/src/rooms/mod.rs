//! 协作房间：多个 Agent 一起完成一个需求，一位统筹拆活、派活、跟进度，
//! 其他成员各管自己的职责。模型照 CCCC（Apache-2.0，见 `third_party/cccc/NOTICE.md`）。
//!
//! - `model`：数据结构与纯规则（角色权限、收件人解析、任务状态迁移）；
//! - `ops`：房间上的每个动作，产出要投递的消息；
//! - `ledger`：只追加的消息账本；
//! - `store`：落盘与并发；
//! - `directory`：成员经 `belfry room …` 进来的入口；
//! - `commands`：界面的 Tauri 命令。
//!
//! 投递复用协作总线：房间消息排进 `TaskBoard`、经 Prompt 队列进成员终端，
//! 送达后对账记进账本。

pub mod commands;
mod directory;
mod ledger;
mod model;
mod ops;
mod store;

pub use store::RoomStore;

/// 给协作总线挂的成员入口。
pub fn member_directory(
    store: std::sync::Arc<RoomStore>,
    registry: std::sync::Arc<crate::collab::SessionRegistry>,
) -> std::sync::Arc<dyn crate::collab::RoomDirectory> {
    std::sync::Arc::new(directory::MemberDirectory { store, registry })
}

/// 测试里搭房间用：跳过界面，直接加成员（第一位自动当统筹）。
#[cfg(test)]
pub mod test_support {
    pub fn add(room: &mut super::model::Room, tab_id: &str, title: &str, duty: &str) -> Result<(), String> {
        super::ops::add_member(room, tab_id, "claude", title, duty, false, super::model::now_millis()).map(|_| ())
    }
}

#[cfg(test)]
#[path = "rooms_test.rs"]
mod rooms_test;
