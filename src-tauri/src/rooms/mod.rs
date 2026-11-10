//! 协作房间：多个 Agent 一起完成一个需求，一位统筹拆活、派活、跟进度，
//! 其他成员各管自己的职责。模型照 CCCC（Apache-2.0，见 `third_party/cccc/NOTICE.md`）。
//!
//! - `model`：数据结构与纯规则（角色权限、收件人解析、任务状态迁移）；
//! - `ops`：房间上的每个动作，产出要投递的消息；
//! - `ledger`：只追加的消息账本；
//! - `store`：落盘与并发；
//! - `directory`：成员经 `belfry room …` 进来的入口；
//! - `attachments`：附件副本的存取与校验；
//! - `commands` / `attachment_commands`：界面的 Tauri 命令。
//!
//! 新模式由持久收件箱收集原文，在真实输入机会冻结批次；送达事实再补回账本。
//! 切换前仍兼容 `TaskBoard` 的旧投递，切换标记保证仅一个投递 owner。

pub mod attachment_commands;
mod attachments;
mod clipboard_files;
pub mod commands;
mod directory;
mod ledger;
mod history;
pub(crate) mod model;
pub(crate) mod ops;
mod store;

pub use store::RoomStore;

/// Legacy test directory; production adds authenticated inbox operations below.
#[cfg(test)]
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

#[cfg(test)]
#[path = "history_test.rs"]
mod history_test;

#[cfg(test)]
#[path = "project_path_test.rs"]
mod project_path_test;

pub(crate) mod semantics;

/// Production directory adds authenticated inbox commands without changing legacy test fixtures.
pub(crate) fn inbox_directory(store: std::sync::Arc<RoomStore>, registry: std::sync::Arc<crate::collab::SessionRegistry>, inbox: std::sync::Arc<crate::collab::inbox::InboxService>) -> std::sync::Arc<dyn crate::collab::RoomDirectory> {
    struct Directory { member: directory::MemberDirectory, inbox: std::sync::Arc<crate::collab::inbox::InboxService> }
    impl crate::collab::RoomDirectory for Directory {
        fn inbox_capable(&self) -> bool { true }
        fn handle(&self, tab: &str, command: &belfry_protocol::Command) -> Result<(belfry_protocol::ResponseData, Vec<crate::collab::RoomPost>), String> {
            match command {
                belfry_protocol::Command::CollaborationInbox { command } => self.inbox.agent(tab, command).map(|data| (data, vec![])),
                _ => self.member.handle(tab, command),
            }
        }
        fn enqueue_posts(&self, board: &crate::collab::TaskBoard, registry: &crate::collab::SessionRegistry, posts: &[crate::collab::RoomPost]) -> Result<(), String> {
            self.member.enqueue_posts(board, registry, posts)
        }
    }
    std::sync::Arc::new(Directory { member: directory::MemberDirectory { store, registry }, inbox })
}
