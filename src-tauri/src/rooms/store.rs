//! 房间存储与对账（设计见 `docs/design/collaboration-room/production-design.md`）。
//!
//! 存储取向照 `provider/store.rs`：版本化 JSON + 原子替换。版本认不出来时
//! 只读运行——不覆盖现场，修改类命令原样报错，让人先处理旧文件。

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use belfry_protocol::{RoomBrief, RoomLine, RoomReactionCount, RoomTaskBrief};

use crate::atomic::{read_text_optional, write_atomic};
use crate::collab::task::{TaskBoard, TaskState};
use crate::terminal::AppError;

pub const STORE_VERSION: u32 = 1;
/// 每房间消息上限：超出时裁掉最旧的系统事件；用户消息与派活永久保留。
const MAX_MESSAGES_PER_ROOM: usize = 500;
/// 任务摘要长度，和原型一致：首 18 个字。
const TITLE_CHARS: usize = 18;
/// 产物快照的文本上限：32 KB。超出的部分截断并如实标注。
pub const ARTIFACT_LIMIT: usize = 32 * 1024;

/// 允许的表情回应（与房间界面的快捷按钮同一组，改一处要两处都改）。
pub const REACTION_EMOJIS: &[&str] = &["👍", "✅", "👀", "🎉", "❤️", "🙏"];

pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

pub(crate) fn new_id() -> String {
    ulid::Ulid::generate().to_string().to_lowercase()
}

/// 派活内容的第一行摘要，给任务卡片用。空白压平，超长截断加省略号。
pub(crate) fn summarize(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut title: String = flat.chars().take(TITLE_CHARS).collect();
    if flat.chars().count() > TITLE_CHARS {
        title.push('…');
    }
    title
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoreFile {
    version: u32,
    rooms: Vec<Room>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    pub id: String,
    pub name: String,
    /// v1：房间归属一个项目根（成员都从该项目里拉，派发沿用同项目闸门）。
    pub project_root: String,
    /// 建房间之后扩展进来的项目根（添加成员时带入）。范围只增不减：
    /// 收紧会静默掐掉某些成员的派发，那是用户没点头的破坏性动作。
    #[serde(default)]
    pub extra_roots: Vec<String>,
    pub created_at: i64,
    pub members: Vec<RoomMember>,
    pub messages: Vec<RoomMessage>,
    pub decisions: Vec<RoomDecision>,
    pub tasks: Vec<RoomTask>,
    /// 成员间互相转手的登记：对方接活后交差时，回复也要回到这间房的时间线——
    /// 聊天不能断在交接处。
    #[serde(default)]
    pub delegations: Vec<RoomDelegation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomMember {
    pub id: String,
    /// 绑定的会话 tabId；「更换会话」只改它，memberId 与历史引用不动。
    pub tab_id: String,
    /// 配置名（claude / codex / pi）。开放字符串，房间层不比较取值。
    pub agent: String,
    /// 角色名，房间内唯一。历史消息按 memberId 解析到它。
    pub role: String,
    pub duty: String,
    pub joined_at: i64,
    /// 软删除：离开后不再参与派发，历史引用仍可显示。
    #[serde(default)]
    pub left_at: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageKind {
    User,
    System,
    /// 房间成员自己说的话（`belfry room say`、交差回执回显）。
    Member,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomMessage {
    pub id: String,
    pub at: i64,
    pub kind: MessageKind,
    /// `user` 或 memberId 或 `system`。
    pub author: String,
    pub text: String,
    /// 派活接收者（讨论消息为空）。
    #[serde(default)]
    pub member_ids: Vec<String>,
    /// 派活消息内嵌的任务卡片指向它。
    #[serde(default)]
    pub task_id: Option<String>,
    /// 群聊送达回执：这条消息已进入过哪些成员的终端（对账写入）。
    /// 只记「送达」——成员读没读、回没回，我们无从知道，绝不假装。
    #[serde(default)]
    pub delivered_to: Vec<String>,
    /// 引用回复：指向被引用的消息 id。被引用的消息清掉后，界面显示为
    /// 「引用的消息已不在」，引用本身留在原地。
    #[serde(default)]
    pub reply_to: Option<String>,
    /// 表情回应（一人一表情最多一条；再点一次即取消）。
    #[serde(default)]
    pub reactions: Vec<RoomReaction>,
    /// 撤回时刻。只对「自己刚发的消息」生效；已经进过成员终端的撤不回来，
    /// 界面如实标注，绝不假装没发生过。
    #[serde(default)]
    pub recalled_at: Option<i64>,
}

/// 一条表情回应：谁、什么表情、什么时候。只记事实，不解释意图。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomReaction {
    /// memberId，或用户自己的 `user`。
    pub member_id: String,
    pub emoji: String,
    pub at: i64,
}

/// 一次成员间的转手：谁把哪条总线任务交给了谁。
///
/// 转手对象不是房间派发的任务（不在 `Room.tasks` 里），但它的交差同样要回到
/// 时间线——`reconcile` 靠这份登记找回执。`echoed_at` 保证只回显一次。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomDelegation {
    pub id: String,
    /// 被转手的那条总线任务 id；对账靠它找交差。
    pub bus_task_id: String,
    pub from_member_id: String,
    pub to_member_id: String,
    /// 转手内容摘要（系统留痕与排错用）。
    pub text: String,
    pub at: i64,
    /// 回显时间；None＝对方还没交差。回显只做一次。
    #[serde(default)]
    pub echoed_at: Option<i64>,
}

/// 对账时对一条待回显的转手登记要做的那一下。
enum DelegationEcho {
    /// 以转手对象的口吻回显交差结果。
    Member { member_id: String, text: String },
    /// 系统摘要（交差没带结果 / 交不了 / 结果未知）。
    Notice(String),
    /// 只记为已处理，不落消息（与房间任务投递「不宣布的终态」同口径）。
    Mark,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomDecision {
    pub id: String,
    pub at: i64,
    pub by: String,
    pub text: String,
    #[serde(default)]
    pub message_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeliveryState {
    Queued,
    Dispatched,
    Done,
    Failed,
    Abandoned,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStage {
    Dispatching,
    Running,
    Submitted,
    Verified,
    Rejected,
    Stopped,
    Failed,
    Interrupted,
}

/// 一条投递：一条房间任务扇出到一位成员的总线任务。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub member_id: String,
    /// 关联 TaskBoard 的完整任务 id。任务表只在内存，应用重启后查不到，
    /// 此时按 Unknown 回写（见 `reconcile`）。
    #[serde(default)]
    pub bus_task_id: Option<String>,
    pub state: DeliveryState,
    #[serde(default)]
    pub result: Option<String>,
    pub at: i64,
}

/// 交差时采集的工作区快照（产物证据）。文本上限由采集方控制。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskArtifact {
    pub captured_at: i64,
    pub truncated: bool,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomTask {
    pub id: String,
    pub title: String,
    pub text: String,
    pub member_ids: Vec<String>,
    /// 可选验收条件；原型里自动生成两条的行为不进生产。
    #[serde(default)]
    pub acceptance: Vec<String>,
    pub created_at: i64,
    /// 派生状态，由 reconcile / 各命令统一维护；规则表见生产设计 §3。
    pub stage: TaskStage,
    /// 第几轮派发（重新派发时 +1）。
    #[serde(default = "one")]
    pub attempt: u32,
    pub deliveries: Vec<Delivery>,
    #[serde(default)]
    pub verified_at: Option<i64>,
    #[serde(default)]
    pub verification_note: Option<String>,
    /// 验证不通过时的退回记录；反馈原文在跟进任务的 `text` 里，这里留档。
    #[serde(default)]
    pub rejected_at: Option<i64>,
    #[serde(default)]
    pub rejection_note: Option<String>,
    #[serde(default)]
    pub stopped_at: Option<i64>,
    /// 交差时采集的工作区差异快照；不在 Git 仓库或采集失败时为 None。
    #[serde(default)]
    pub artifact: Option<TaskArtifact>,
}

fn one() -> u32 {
    1
}

impl RoomTask {
    /// 按优先级派生任务整体状态。规则表见生产设计 §3，顺序不能换：
    /// 验证 > 退回 > 停止 > 失败 > 交差聚合 > 在途 > 结果未知。
    pub(crate) fn refresh_stage(&mut self) {
        self.stage = if self.verified_at.is_some() {
            TaskStage::Verified
        } else if self.rejected_at.is_some() {
            TaskStage::Rejected
        } else if self.stopped_at.is_some() {
            TaskStage::Stopped
        } else if self.deliveries.iter().any(|d| d.state == DeliveryState::Failed) {
            TaskStage::Failed
        } else {
            let done = self.deliveries.iter().filter(|d| d.state == DeliveryState::Done).count();
            let in_flight = self
                .deliveries
                .iter()
                .any(|d| matches!(d.state, DeliveryState::Queued | DeliveryState::Dispatched));
            let gone = self
                .deliveries
                .iter()
                .any(|d| matches!(d.state, DeliveryState::Abandoned | DeliveryState::Unknown));
            if done > 0 && !in_flight {
                TaskStage::Submitted
            } else if done > 0 {
                TaskStage::Running
            } else if !in_flight && gone {
                TaskStage::Interrupted
            } else if self.deliveries.iter().any(|d| d.state == DeliveryState::Dispatched) {
                TaskStage::Running
            } else {
                TaskStage::Dispatching
            }
        };
    }
}

impl Room {
    pub(crate) fn push_system(&mut self, text: impl Into<String>, now: i64) {
        self.messages.push(RoomMessage {
            id: new_id(),
            at: now,
            kind: MessageKind::System,
            author: "system".to_string(),
            text: text.into(),
            member_ids: Vec::new(),
            task_id: None,
            delivered_to: Vec::new(),
            reply_to: None,
            reactions: Vec::new(),
            recalled_at: None,
        });
        self.prune_messages();
    }

    /// 成员说的一句话。author 存 memberId，显示时按当前角色名解析。
    pub(crate) fn push_member(
        &mut self,
        member_id: &str,
        text: String,
        member_ids: Vec<String>,
        task_id: Option<String>,
        reply_to: Option<String>,
        now: i64,
    ) -> String {
        let id = new_id();
        self.messages.push(RoomMessage {
            id: id.clone(),
            at: now,
            kind: MessageKind::Member,
            author: member_id.to_string(),
            text,
            member_ids,
            task_id,
            delivered_to: Vec::new(),
            reply_to,
            reactions: Vec::new(),
            recalled_at: None,
        });
        self.prune_messages();
        id
    }

    fn push_user(
        &mut self,
        id: String,
        text: String,
        member_ids: Vec<String>,
        task_id: Option<String>,
        reply_to: Option<String>,
        now: i64,
    ) {
        self.messages.push(RoomMessage {
            id,
            at: now,
            kind: MessageKind::User,
            author: "user".to_string(),
            text,
            member_ids,
            task_id,
            delivered_to: Vec::new(),
            reply_to,
            reactions: Vec::new(),
            recalled_at: None,
        });
        self.prune_messages();
    }

    /// 只裁最旧的系统事件；用户消息与派活/决定不裁。
    fn prune_messages(&mut self) {
        if self.messages.len() <= MAX_MESSAGES_PER_ROOM {
            return;
        }
        let overflow = self.messages.len() - MAX_MESSAGES_PER_ROOM;
        let mut removed = 0usize;
        self.messages.retain(|message| {
            if removed < overflow && message.kind == MessageKind::System {
                removed += 1;
                false
            } else {
                true
            }
        });
    }

    /// 转手登记只留最近一段：优先裁已经回显过的旧条目。
    fn prune_delegations(&mut self) {
        const MAX_DELEGATIONS_PER_ROOM: usize = 100;
        if self.delegations.len() <= MAX_DELEGATIONS_PER_ROOM {
            return;
        }
        let overflow = self.delegations.len() - MAX_DELEGATIONS_PER_ROOM;
        let mut removed = 0usize;
        self.delegations.retain(|entry| {
            if removed < overflow && entry.echoed_at.is_some() {
                removed += 1;
                false
            } else {
                true
            }
        });
    }

    pub(crate) fn active_member(&self, member_id: &str) -> Option<&RoomMember> {
        self.members
            .iter()
            .find(|member| member.id == member_id && member.left_at.is_none())
    }

    /// 按会话寻址的成员（`belfry send` 转手时只有 tabId，memberId 得现查）。
    pub(crate) fn active_member_by_tab(&self, tab_id: &str) -> Option<&RoomMember> {
        self.members
            .iter()
            .find(|member| member.tab_id == tab_id && member.left_at.is_none())
    }

    /// 目标项目在房间声明的范围里吗。范围 = 建房间的项目 + 后来扩展进来的根。
    pub(crate) fn covers_project(&self, root: &str) -> bool {
        self.project_root == root || self.extra_roots.iter().any(|declared| declared == root)
    }
}

struct Inner {
    rooms: Vec<Room>,
    path: Option<PathBuf>,
    writable: bool,
    load_error: Option<String>,
}

/// 房间集合的持久化存储。进程内一把 Mutex 串行化读改写。
pub struct RoomStore {
    inner: Mutex<Inner>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomsView {
    pub rooms: Vec<RoomSummary>,
    /// 存储读不出来时的原因（版本不认识 / 文件损坏）。界面如实展示。
    pub load_error: Option<String>,
}

/// 「已提交待验证」任务的身份与文案，给 App 层的提醒轮询用。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingReview {
    pub room_id: String,
    pub room_name: String,
    pub task_id: String,
    pub title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSummary {
    pub id: String,
    pub name: String,
    pub project_root: String,
    pub created_at: i64,
    pub member_count: usize,
    /// 在房成员的会话 tabId：前端按它把这些会话从侧栏 / Quick Open 里隔离掉。
    pub member_tab_ids: Vec<String>,
    /// 需要人关注的任务数：投递中 / 进行中 / 待验证。
    pub active_task_count: usize,
    /// 时间线最新一条消息（发言 / 注记都算）的时刻；房间列表按它结合本地已读位画未读点。
    /// 没有消息为 None——清空聊天记录后回到 None。
    pub last_message_at: Option<i64>,
}

impl RoomStore {
    /// 从磁盘装载。路径为 None（应用数据目录都拿不到）或文件读不出来时，
    /// 以只读空存储运行：读取类命令可用，修改类命令原样报错，不覆盖现场。
    pub fn load(path: Option<PathBuf>) -> Self {
        let readonly = |message: String| Inner {
            rooms: Vec::new(),
            path: None,
            writable: false,
            load_error: Some(message),
        };
        let inner = match path {
            None => readonly("找不到应用数据目录，房间无法保存。".to_string()),
            Some(path) => match read_text_optional(&path) {
                Err(error) => readonly(format!("房间存储读取失败：{}", error.message)),
                Ok(text) if text.trim().is_empty() => Inner {
                    rooms: Vec::new(),
                    path: Some(path),
                    writable: true,
                    load_error: None,
                },
                Ok(text) => match serde_json::from_str::<StoreFile>(&text) {
                    Ok(file) if file.version == STORE_VERSION => Inner {
                        rooms: file.rooms,
                        path: Some(path),
                        writable: true,
                        load_error: None,
                    },
                    Ok(file) => readonly(format!(
                        "房间存储版本是 {}，当前版本只认识 {}；已按只读处理，请在更新前保留原文件。",
                        file.version, STORE_VERSION
                    )),
                    Err(error) => readonly(format!("房间存储解析失败：{error}；已按只读处理。")),
                },
            },
        };
        Self {
            inner: Mutex::new(inner),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Inner>, AppError> {
        self.inner
            .lock()
            .map_err(|_| AppError::io("房间存储锁不上，请重启应用后重试。"))
    }

    pub fn list(&self) -> Result<RoomsView, AppError> {
        let inner = self.lock()?;
        let rooms = inner
            .rooms
            .iter()
            .map(|room| RoomSummary {
                id: room.id.clone(),
                name: room.name.clone(),
                project_root: room.project_root.clone(),
                created_at: room.created_at,
                member_count: room.members.iter().filter(|m| m.left_at.is_none()).count(),
                member_tab_ids: room
                    .members
                    .iter()
                    .filter(|m| m.left_at.is_none())
                    .map(|m| m.tab_id.clone())
                    .collect(),
                active_task_count: room
                    .tasks
                    .iter()
                    .filter(|task| {
                        matches!(
                            task.stage,
                            TaskStage::Dispatching | TaskStage::Running | TaskStage::Submitted
                        )
                    })
                    .count(),
                last_message_at: room.messages.iter().map(|message| message.at).max(),
            })
            .collect();
        Ok(RoomsView {
            rooms,
            load_error: inner.load_error.clone(),
        })
    }

    /// 处于「已提交待验证」的任务清单（跨全部房间）。只要身份与文案，不要整间房。
    pub fn pending_reviews(&self) -> Result<Vec<PendingReview>, AppError> {
        let inner = self.lock()?;
        Ok(inner
            .rooms
            .iter()
            .flat_map(|room| {
                room.tasks
                    .iter()
                    .filter(|task| task.stage == TaskStage::Submitted)
                    .map(|task| PendingReview {
                        room_id: room.id.clone(),
                        room_name: room.name.clone(),
                        task_id: task.id.clone(),
                        title: task.title.clone(),
                    })
            })
            .collect())
    }

    pub fn get(&self, id: &str) -> Result<Room, AppError> {
        let inner = self.lock()?;
        inner
            .rooms
            .iter()
            .find(|room| room.id == id)
            .cloned()
            .ok_or_else(|| AppError::not_found("找不到这个房间"))
    }

    pub fn create(&self, name: &str, project_root: &str) -> Result<Room, AppError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::invalid_argument("房间名是必填的"));
        }
        if name.chars().count() > 40 {
            return Err(AppError::invalid_argument("房间名最多 40 个字"));
        }
        if project_root.trim().is_empty() {
            return Err(AppError::invalid_argument("房间要挂在一个项目上"));
        }
        let now = now_millis();
        let mut inner = self.lock()?;
        let room = Room {
            id: new_id(),
            name: name.to_string(),
            project_root: project_root.trim().to_string(),
            extra_roots: Vec::new(),
            created_at: now,
            members: Vec::new(),
            messages: Vec::new(),
            decisions: Vec::new(),
            tasks: Vec::new(),
            delegations: Vec::new(),
        };
        inner.rooms.push(room);
        let created = inner.rooms.last().cloned().expect("刚插入");
        save(&inner)?;
        Ok(created)
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<Room, AppError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::invalid_argument("房间名是必填的"));
        }
        let mut inner = self.lock()?;
        let room = inner.room_mut(id)?;
        room.name = name.to_string();
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    /// 把房间的接活范围扩到另一个根（添加成员时由命令层带入）。
    /// 已经覆盖时是空操作；**从不自动收紧**——收紧要留给用户显式决定。
    pub fn extend_project(&self, room_id: &str, root: &str) -> Result<Room, AppError> {
        let root = root.trim();
        if root.is_empty() {
            return Err(AppError::invalid_argument("项目根不能为空"));
        }
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        if room.covers_project(root) {
            return Ok(room.clone());
        }
        room.extra_roots.push(root.to_string());
        room.push_system(
            format!(
                "房间的接活范围扩展到「{}」，该项目里的会话也能接活了。",
                summarize(root)
            ),
            now_millis(),
        );
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let mut inner = self.lock()?;
        let before = inner.rooms.len();
        inner.rooms.retain(|room| room.id != id);
        if inner.rooms.len() == before {
            return Err(AppError::not_found("找不到这个房间"));
        }
        save(&inner)
    }

    pub fn add_member(
        &self,
        room_id: &str,
        tab_id: &str,
        agent: &str,
        role: &str,
        duty: &str,
    ) -> Result<Room, AppError> {
        let role = role.trim();
        if role.is_empty() {
            return Err(AppError::invalid_argument("角色名是必填的"));
        }
        if role.chars().count() > 24 {
            return Err(AppError::invalid_argument("角色名最多 24 个字"));
        }
        let now = now_millis();
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        if room
            .members
            .iter()
            .any(|member| member.left_at.is_none() && member.tab_id == tab_id)
        {
            return Err(AppError::invalid_argument("这条会话已经在房间里了"));
        }
        let role = unique_role(room, role);
        room.members.push(RoomMember {
            id: new_id(),
            tab_id: tab_id.to_string(),
            agent: agent.to_string(),
            role: role.clone(),
            duty: duty.trim().to_string(),
            joined_at: now,
            left_at: None,
        });
        room.push_system(format!("「{role}」加入了房间。"), now);
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    pub fn update_member(
        &self,
        room_id: &str,
        member_id: &str,
        role: Option<String>,
        duty: Option<String>,
        tab_id: Option<String>,
    ) -> Result<Room, AppError> {
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        if room.active_member(member_id).is_none() {
            return Err(AppError::not_found("找不到这位成员（或已离开）"));
        }
        if let Some(tab_id) = &tab_id
            && room.members.iter().any(|member| {
                member.left_at.is_none() && member.tab_id == *tab_id && member.id != member_id
            })
        {
            return Err(AppError::invalid_argument("这条会话已经是另一位成员了"));
        }
        if let Some(role) = &role {
            let role = role.trim();
            if role.is_empty() {
                return Err(AppError::invalid_argument("角色名是必填的"));
            }
            let taken = room.members.iter().any(|member| {
                member.left_at.is_none() && member.role == role && member.id != member_id
            });
            if taken {
                return Err(AppError::invalid_argument(format!("「{role}」已经是另一位成员了")));
            }
        }
        let now = now_millis();
        let mut renamed_from = None;
        let member = room
            .members
            .iter_mut()
            .find(|member| member.id == member_id)
            .expect("前面查过存在");
        if let Some(role) = role {
            renamed_from = Some(member.role.clone());
            member.role = role.trim().to_string();
        }
        if let Some(duty) = duty {
            member.duty = duty.trim().to_string();
        }
        if let Some(tab_id) = tab_id {
            member.tab_id = tab_id;
        }
        if let (Some(from), Some(to)) = (renamed_from, room.members.iter().find(|m| m.id == member_id).map(|m| m.role.clone()))
            && from != to
        {
            room.push_system(format!("「{from}」改名为「{to}」。"), now);
        }
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    pub fn remove_member(&self, room_id: &str, member_id: &str) -> Result<Room, AppError> {
        let now = now_millis();
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        let role = {
            let member = room
                .members
                .iter_mut()
                .find(|member| member.id == member_id && member.left_at.is_none())
                .ok_or_else(|| AppError::not_found("找不到这位成员（或已离开）"))?;
            member.left_at = Some(now);
            member.role.clone()
        };
        room.push_system(format!("「{role}」离开了房间；历史记录保留。"), now);
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    /// 纯讨论消息：不派活、不触发任何自动回复。
    pub fn send_message(&self, room_id: &str, text: &str, reply_to: Option<String>) -> Result<Room, AppError> {
        self.record_chat(room_id, &new_id(), text, Vec::new(), reply_to)
    }

    /// 记录一条用户群聊消息（时间线气泡）。`message_id` 由调用方生成：
    /// 投递送达后要按它把回执写回这条消息。`member_ids` 是送达对象——
    /// 群聊不建交差任务、不要求交差，投递在总线层完成（见 `room_broadcast`）。
    pub fn record_chat(
        &self,
        room_id: &str,
        message_id: &str,
        text: &str,
        member_ids: Vec<String>,
        reply_to: Option<String>,
    ) -> Result<Room, AppError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(AppError::invalid_argument("消息不能为空"));
        }
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        // 引用必须指向房间里真实存在的消息：不落悬空的引用。
        if let Some(target) = &reply_to
            && !room.messages.iter().any(|message| &message.id == target)
        {
            return Err(AppError::invalid_argument("引用的消息不在这个房间里"));
        }
        room.push_user(
            message_id.to_string(),
            text.to_string(),
            member_ids,
            None,
            reply_to,
            now_millis(),
        );
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    /// 清空房间的聊天记录（时间线上的全部消息）。任务、决定、投递与转手登记
    /// 一律保留——时间线清掉之后，右栏仍要能查任务与决定；成员终端里的对话
    /// 不受影响。不留系统留痕：清空后的空白本身就是结果。
    pub fn clear_messages(&self, room_id: &str) -> Result<Room, AppError> {
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        room.messages.clear();
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    pub fn mark_decision(&self, room_id: &str, message_id: &str) -> Result<Room, AppError> {
        let now = now_millis();
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        let message = room
            .messages
            .iter()
            .find(|message| message.id == message_id)
            .cloned()
            .ok_or_else(|| AppError::not_found("找不到这条消息"))?;
        room.decisions.push(RoomDecision {
            id: new_id(),
            at: now,
            by: message.author.clone(),
            text: message.text.clone(),
            message_id: Some(message.id.clone()),
        });
        room.push_system(format!("记录了决定：{}", message.text), now);
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    /// 记录一次派发（任务 + 消息）。**保存成功后才允许投递**——调用方
    /// 先调这里、再往 TaskBoard 里插，避免「房间没记住、成员已经开工」。
    pub fn record_dispatch(
        &self,
        room_id: &str,
        task: RoomTask,
        message: RoomMessage,
    ) -> Result<Room, AppError> {
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        room.tasks.push(task);
        room.messages.push(message);
        room.prune_messages();
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    /// 登记一次成员间的转手：转手对象的交差要回显进时间线，聊天不能断在交接处。
    ///
    /// `room_id` 为 None 时（`belfry send` 直派没有房间上下文）按「两边都是在房
    /// 成员」的房间解析，同房的每间都记一份；找不到就什么都不做——这是增强，
    /// 不该挡住投递。`announce` 为 true 时补一条系统留痕（send 路径在时间线上
    /// 没有别的痕迹；房间点名本身已经有成员消息）。调用方必须**先入任务板、
    /// 再登记**：登记在前会让对账抢先看到「任务不存在」而误报结果未知。
    pub fn record_delegation(
        &self,
        room_id: Option<&str>,
        from_tab: &str,
        to_tab: &str,
        bus_task_id: &str,
        text: &str,
        announce: bool,
    ) -> Result<(), AppError> {
        let now = now_millis();
        let mut inner = self.lock()?;
        let targets: Vec<usize> = match room_id {
            Some(id) => inner
                .rooms
                .iter()
                .position(|room| room.id == id)
                .into_iter()
                .collect(),
            None => inner
                .rooms
                .iter()
                .enumerate()
                .filter(|(_, room)| {
                    room.active_member_by_tab(from_tab).is_some()
                        && room.active_member_by_tab(to_tab).is_some()
                })
                .map(|(index, _)| index)
                .collect(),
        };
        let mut changed = false;
        for index in targets {
            let room = &mut inner.rooms[index];
            let (from_id, from_role) = match room.active_member_by_tab(from_tab) {
                Some(member) => (member.id.clone(), member.role.clone()),
                None => continue,
            };
            let (to_id, to_role) = match room.active_member_by_tab(to_tab) {
                Some(member) => (member.id.clone(), member.role.clone()),
                None => continue,
            };
            room.delegations.push(RoomDelegation {
                id: new_id(),
                bus_task_id: bus_task_id.to_string(),
                from_member_id: from_id,
                to_member_id: to_id,
                text: summarize(text),
                at: now,
                echoed_at: None,
            });
            if announce {
                room.push_system(
                    format!(
                        "「{from_role}」把任务交给了「{to_role}」：{}",
                        summarize(text)
                    ),
                    now,
                );
            }
            room.prune_delegations();
            changed = true;
        }
        if changed {
            save(&inner)?;
        }
        Ok(())
    }

    /// 用户停止一条任务：投递回写为 Abandoned，任务记为已停止。
    /// 已经交到成员终端的那一步拦不回来——总线与房间都如实显示这一点。
    pub fn stop_task(&self, room_id: &str, task_id: &str, now: i64) -> Result<Room, AppError> {
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        let title;
        {
            let task = room
                .tasks
                .iter_mut()
                .find(|task| task.id == task_id)
                .ok_or_else(|| AppError::not_found("找不到这条任务"))?;
            if task.verified_at.is_some() || task.stopped_at.is_some() {
                return Err(AppError::invalid_argument("这条任务已经结束了"));
            }
            for delivery in &mut task.deliveries {
                if matches!(
                    delivery.state,
                    DeliveryState::Queued | DeliveryState::Dispatched | DeliveryState::Unknown
                ) {
                    delivery.state = DeliveryState::Abandoned;
                    delivery.at = now;
                }
            }
            task.stopped_at = Some(now);
            task.refresh_stage();
            title = task.title.clone();
        }
        room.push_system(
            format!("任务「{title}」已停止；已经交差的记录与产物保留。"),
            now,
        );
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    /// 人工验证。只有「已提交待验证」的任务可以通过；验证独立于提交，
    /// 记录里留下时间与备注。
    pub fn verify_task(
        &self,
        room_id: &str,
        task_id: &str,
        note: Option<String>,
        now: i64,
    ) -> Result<Room, AppError> {
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        let title;
        {
            let task = room
                .tasks
                .iter_mut()
                .find(|task| task.id == task_id)
                .ok_or_else(|| AppError::not_found("找不到这条任务"))?;
            if task.verified_at.is_some() {
                return Err(AppError::invalid_argument("这条任务已经验证过了"));
            }
            if task.rejected_at.is_some() {
                return Err(AppError::invalid_argument("已退回重做的任务不能验证"));
            }
            if task.stopped_at.is_some() {
                return Err(AppError::invalid_argument("已停止的任务不能验证"));
            }
            if task.stage != TaskStage::Submitted {
                return Err(AppError::invalid_argument("还没有可验证的交付（成员尚未全部交差）"));
            }
            task.verified_at = Some(now);
            task.verification_note = note.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
            // verified_at 只是标记位；整体状态由派生规则统一刷新。忘了这一步，
            // 界面会一直停在「已提交待验证」，直到下一次对账才翻过来。
            task.refresh_stage();
            title = task.title.clone();
        }
        let message = room
            .tasks
            .iter()
            .find(|task| task.id == task_id)
            .and_then(|task| task.verification_note.clone())
            .map(|note| format!("任务「{title}」验证通过。备注：{note}"))
            .unwrap_or_else(|| format!("任务「{title}」验证通过。"));
        room.push_system(message, now);
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    /// 验证不通过：旧任务盖上「已退回」，跟进任务一并入库。
    ///
    /// 旧任务与跟进任务在同一次保存里落盘：不能出现「旧的退了、新的没建」
    /// 或反过来的中间态。跟进任务的投递由命令层先过完闸门再传进来，
    /// 闸门不过时这里从头到尾都不会被调用。
    pub fn reject_task(
        &self,
        room_id: &str,
        task_id: &str,
        note: &str,
        now: i64,
        follow_up: RoomTask,
        follow_up_message: RoomMessage,
    ) -> Result<Room, AppError> {
        let note = note.trim();
        if note.is_empty() {
            return Err(AppError::invalid_argument("退回时要写清哪里没通过"));
        }
        if follow_up.deliveries.is_empty() {
            return Err(AppError::invalid_argument("跟进任务没有可投递的成员"));
        }
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        let title;
        {
            let task = room
                .tasks
                .iter_mut()
                .find(|task| task.id == task_id)
                .ok_or_else(|| AppError::not_found("找不到这条任务"))?;
            if task.verified_at.is_some() {
                return Err(AppError::invalid_argument("这条任务已经验证过了"));
            }
            if task.rejected_at.is_some() {
                return Err(AppError::invalid_argument("这条任务已经退回过了"));
            }
            if task.stopped_at.is_some() {
                return Err(AppError::invalid_argument("已停止的任务不能退回"));
            }
            if task.stage != TaskStage::Submitted {
                return Err(AppError::invalid_argument("只有「已提交待验证」的任务可以退回重做"));
            }
            task.rejected_at = Some(now);
            task.rejection_note = Some(note.to_string());
            task.refresh_stage();
            title = task.title.clone();
        }
        room.tasks.push(follow_up);
        room.messages.push(follow_up_message);
        room.push_system(
            format!("任务「{title}」验证未通过，已退回重做；带反馈的跟进任务已派出。"),
            now,
        );
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    /// 重新派发：把「结果未知」的整条任务换一批新的总线任务再投一轮；
    /// 指定 `members` 时只补投这几位（限「结果未知 / 已停止 / 失败」的投递）。
    /// 上一轮的结果以系统消息留痕；没被选中的投递一个字都不动。
    pub fn retry_task(
        &self,
        room_id: &str,
        task_id: &str,
        members: Option<Vec<String>>,
        now: i64,
        replacement: Vec<(String, String)>,
    ) -> Result<Room, AppError> {
        if replacement.is_empty() {
            return Err(AppError::invalid_argument("没有需要重新派发的成员"));
        }
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        let title;
        let round;
        let summary;
        {
            let task = room
                .tasks
                .iter_mut()
                .find(|task| task.id == task_id)
                .ok_or_else(|| AppError::not_found("找不到这条任务"))?;
            if task.verified_at.is_some() || task.rejected_at.is_some() || task.stopped_at.is_some() {
                return Err(AppError::invalid_argument("这条任务已经结束了"));
            }
            match &members {
                None => {
                    if task.stage != TaskStage::Interrupted {
                        return Err(AppError::invalid_argument("只有「结果未知」的任务可以整体重新派发"));
                    }
                    summary = format!("上一轮 {} 条投递结果未确认。", task.deliveries.len());
                }
                Some(members) => {
                    if members.is_empty() {
                        return Err(AppError::invalid_argument("先选要重派的成员"));
                    }
                    for member_id in members {
                        let delivery = task
                            .deliveries
                            .iter()
                            .find(|delivery| delivery.member_id == *member_id)
                            .ok_or_else(|| AppError::invalid_argument("有人不在这一轮的投递名单里"))?;
                        if !matches!(
                            delivery.state,
                            DeliveryState::Unknown | DeliveryState::Abandoned | DeliveryState::Failed
                        ) {
                            return Err(AppError::invalid_argument(
                                "只能重派「结果未知」「已停止」或「失败」的那几条投递",
                            ));
                        }
                    }
                    if replacement.len() != members.len() {
                        return Err(AppError::invalid_argument("重派名单和投递名单对不上"));
                    }
                    summary = format!("补投 {} 位成员。", members.len());
                }
            }
            task.attempt += 1;
            round = task.attempt;
            for delivery in &mut task.deliveries {
                if let Some((_, bus_id)) = replacement
                    .iter()
                    .find(|(member_id, _)| member_id == &delivery.member_id)
                {
                    delivery.bus_task_id = Some(bus_id.clone());
                    delivery.state = DeliveryState::Queued;
                    delivery.result = None;
                    delivery.at = now;
                }
            }
            task.refresh_stage();
            title = task.title.clone();
        }
        room.push_system(
            format!("重新派发任务「{title}」（第 {round} 轮）：{summary}"),
            now,
        );
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    /// 把 TaskBoard 的最新状态对账回所有房间：投递状态回写、系统消息留痕、
    /// 任务整体状态重算。这是界面状态唯一被更新的入口。
    pub fn reconcile(&self, board: &TaskBoard, now: i64) -> Result<(), AppError> {
        self.reconcile_with(board, now, None)
    }

    /// 对账并顺带采集产物快照：只有「有投递交差、且快照缺失或落后于最新一次交差」
    /// 时才调用 `capture`（以房间项目根为键）。幂等——重复对账不再重复读 git；
    /// 采集失败不报错，也不写空证据：没有快照的如实没有。
    pub fn reconcile_capturing(
        &self,
        board: &TaskBoard,
        now: i64,
        capture: &dyn Fn(&str) -> Option<TaskArtifact>,
    ) -> Result<(), AppError> {
        self.reconcile_with(board, now, Some(capture))
    }

    fn reconcile_with(
        &self,
        board: &TaskBoard,
        now: i64,
        capture: Option<&dyn Fn(&str) -> Option<TaskArtifact>>,
    ) -> Result<(), AppError> {
        let snapshot = board.snapshot();
        let mut inner = self.lock()?;
        let mut changed = false;
        // 回执记录完的群聊投递：本趟对账结束时统一从板上回收。
        let mut delivered_chat: Vec<String> = Vec::new();
        for room in &mut inner.rooms {
            // 群聊投递的回执也要对：房间可能一条任务都没有。
            let chat_receipts: Vec<crate::collab::task::CollabTask> = snapshot
                .iter()
                .filter(|task| {
                    task.chat.is_some()
                        && task.state == TaskState::Dispatched
                        && matches!(
                            &task.origin,
                            Some(crate::collab::task::TaskOrigin::Room { id, .. }) if id == &room.id
                        )
                })
                .cloned()
                .collect();
            if room.tasks.is_empty() && room.delegations.is_empty() && chat_receipts.is_empty() {
                continue;
            }
            // 先把角色名抄一份：下面要同时可变地借用 tasks。
            let roles: HashMap<String, String> = room
                .members
                .iter()
                .map(|member| (member.id.clone(), member.role.clone()))
                .collect();
            let mut notices: Vec<String> = Vec::new();
            // 交差回执的回显：先收集，等 tasks 的可变借用结束再落进消息。
            let mut echoes: Vec<(String, String, String)> = Vec::new();
            // 采集闭包只拿项目根；先把不可变借用抄下来，循环里才能可变借用 tasks。
            let project_root = room.project_root.clone();
            for task in &mut room.tasks {
                for delivery in &mut task.deliveries {
                    let Some(bus_id) = delivery.bus_task_id.clone() else {
                        continue;
                    };
                    let role = roles
                        .get(&delivery.member_id)
                        .cloned()
                        .unwrap_or_else(|| "（已移除的成员）".to_string());
                    match snapshot.iter().find(|entry| entry.id == bus_id) {
                        Some(entry) => {
                            let next = match entry.state {
                                TaskState::PendingApproval | TaskState::Queued => {
                                    DeliveryState::Queued
                                }
                                TaskState::Dispatched => DeliveryState::Dispatched,
                                TaskState::Done => DeliveryState::Done,
                                TaskState::Failed => DeliveryState::Failed,
                                TaskState::Abandoned => DeliveryState::Abandoned,
                            };
                            if next != delivery.state {
                                match next {
                                    // 交差带结果的话，让成员自己「说」出来：群聊里该看到
                                    // 的是「前端：都改好了」，不是一行系统摘要。
                                    DeliveryState::Done => {
                                        let result = entry
                                            .result
                                            .as_deref()
                                            .map(str::trim)
                                            .filter(|text| !text.is_empty());
                                        match result {
                                            Some(text) => echoes.push((
                                                delivery.member_id.clone(),
                                                task.id.clone(),
                                                text.to_string(),
                                            )),
                                            None => notices.push(format!("「{role}」交差了")),
                                        }
                                    }
                                    DeliveryState::Failed => notices.push(format!(
                                        "「{role}」说做不了{}",
                                        entry
                                            .result
                                            .as_deref()
                                            .map(|result| format!("：{}", summarize_long(result)))
                                            .unwrap_or_default()
                                    )),
                                    _ => {}
                                }
                                delivery.state = next;
                                delivery.result = entry.result.clone();
                                delivery.at = now;
                                changed = true;
                            }
                        }
                        None => {
                            // 任务表只在内存：应用重启后旧编号查不到。如实回写
                            // 为「结果未知」，绝不假装成功。
                            if matches!(
                                delivery.state,
                                DeliveryState::Queued | DeliveryState::Dispatched
                            ) {
                                delivery.state = DeliveryState::Unknown;
                                delivery.at = now;
                                changed = true;
                                notices.push(format!(
                                    "「{role}」的投递结果未知（应用重启或任务记录已回收），可在任务详情里重新派发"
                                ));
                            }
                        }
                    }
                }
                let before = task.stage;
                task.refresh_stage();
                if task.stage != before {
                    changed = true;
                }
                if let Some(capture) = capture {
                    let newest_done = task
                        .deliveries
                        .iter()
                        .filter(|delivery| delivery.state == DeliveryState::Done)
                        .map(|delivery| delivery.at)
                        .max();
                    if let Some(newest_done) = newest_done
                        && task
                            .artifact
                            .as_ref()
                            .map_or(true, |artifact| artifact.captured_at < newest_done)
                        && let Some(artifact) = capture(&project_root)
                    {
                        task.artifact = Some(artifact);
                        changed = true;
                    }
                }
            }
            // 成员转手的回执：转手对象交差后，他的回复以本人之吻回到时间线。
            for index in 0..room.delegations.len() {
                if room.delegations[index].echoed_at.is_some() {
                    continue;
                }
                let bus_id = room.delegations[index].bus_task_id.clone();
                let to_member_id = room.delegations[index].to_member_id.clone();
                let role = roles
                    .get(&to_member_id)
                    .cloned()
                    .unwrap_or_else(|| "（已移除的成员）".to_string());
                let action = match snapshot.iter().find(|entry| entry.id == bus_id) {
                    // 任务记录没了（应用重启或已被回收）：如实标注，绝不假装成功。
                    None => Some(DelegationEcho::Notice(format!(
                        "「{role}」的回复没能送达（应用重启或任务记录已回收）"
                    ))),
                    Some(entry) => match entry.state {
                        TaskState::Done => {
                            let result = entry
                                .result
                                .as_deref()
                                .map(str::trim)
                                .filter(|text| !text.is_empty());
                            Some(match result {
                                Some(text) => DelegationEcho::Member {
                                    member_id: to_member_id.clone(),
                                    text: text.to_string(),
                                },
                                None => DelegationEcho::Notice(format!("「{role}」交差了")),
                            })
                        }
                        TaskState::Failed => Some(DelegationEcho::Notice(format!(
                            "「{role}」说做不了{}",
                            entry
                                .result
                                .as_deref()
                                .map(|result| format!("：{}", summarize_long(result)))
                                .unwrap_or_default()
                        ))),
                        // 停止 / 作废照房间任务的投递口径：不宣布，只记结。
                        TaskState::Abandoned => Some(DelegationEcho::Mark),
                        TaskState::PendingApproval
                        | TaskState::Queued
                        | TaskState::Dispatched => None,
                    },
                };
                if let Some(action) = action {
                    room.delegations[index].echoed_at = Some(now);
                    changed = true;
                    match action {
                        DelegationEcho::Member { member_id, text } => {
                            room.push_member(&member_id, text, Vec::new(), None, None, now);
                        }
                        DelegationEcho::Notice(text) => room.push_system(text, now),
                        DelegationEcho::Mark => {}
                    }
                }
            }
            // 群聊送达回执：投递进过谁的终端，如实记到消息上（只记送达，不假装读过）。
            for receipt in &chat_receipts {
                let member_id = room
                    .members
                    .iter()
                    .find(|member| member.tab_id == receipt.to)
                    .map(|member| member.id.clone());
                if let (Some(member_id), Some(chat)) = (member_id, &receipt.chat) {
                    for message_id in &chat.message_ids {
                        if let Some(message) = room
                            .messages
                            .iter_mut()
                            .find(|message| &message.id == message_id)
                            && !message.delivered_to.contains(&member_id)
                        {
                            message.delivered_to.push(member_id.clone());
                            changed = true;
                        }
                    }
                }
                delivered_chat.push(receipt.id.clone());
            }
            for notice in notices {
                room.push_system(notice, now);
                changed = true;
            }
            for (member_id, _task_id, text) in echoes {
                // 回显不挂任务卡：卡只在发起消息下面出现一次，免得每条回话都拖着同一张。
                room.push_member(&member_id, text, Vec::new(), None, None, now);
                changed = true;
            }
        }
        for id in delivered_chat {
            board.remove(&id);
        }
        if changed {
            save(&inner)?;
        }
        Ok(())
    }

    /// 成员往房间里说一句话（`belfry room say` 的落点）。
    ///
    /// 群聊语义：不带点名的发言发给所有其他成员；`@角色` 收窄投递——只发给被点的人
    /// （请对方接话）。被点的人把活转手给别人时，对方的交差回复经转手登记照旧回到
    /// 时间线，对话不会断在交接处。
    /// 不校验会话活性：说话的是「这个成员」，它的人就站在房间里——投递是另一层的事。
    /// 限速给 Agent 兜底：一间房里一分钟最多 12 条，超了当场拒绝。防的不只是刷屏，
    /// 还有成员之间互相接话时的打转——那是这套机制里唯一能自发跑下去的环。
    pub fn member_say(
        &self,
        tab_id: &str,
        room_hint: Option<&str>,
        text: &str,
        reply_to: Option<&str>,
    ) -> Result<crate::collab::SayOutcome, AppError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(AppError::invalid_argument("说点什么再发"));
        }
        if text.chars().count() > 2000 {
            return Err(AppError::invalid_argument("一条消息最多 2000 字"));
        }
        let now = now_millis();
        let mut inner = self.lock()?;
        let index = resolve_my_room(&inner, tab_id, room_hint)?;
        let room = &mut inner.rooms[index];
        let member = room
            .members
            .iter()
            .find(|member| member.tab_id == tab_id && member.left_at.is_none())
            .cloned()
            .ok_or_else(|| AppError::invalid_argument("你不在这间房里"))?;
        say_rate_guard(&room.id, &member.id, now)?;
        // 引用回复：`room log` 显示的短 id 或完整 id 都认；找不到就当场拒绝，
        // 不落一条指不到人的引用。
        let quoted = match reply_to.map(str::trim).filter(|value| !value.is_empty()) {
            None => None,
            Some(hint) => match room
                .messages
                .iter()
                .rev()
                .find(|message| message.id == hint || short_msg_id(&message.id) == hint)
                .cloned()
            {
                Some(message) => Some(message),
                None => {
                    return Err(AppError::invalid_argument(format!(
                        "没有编号 {hint} 的消息，用 belfry room log 看看"
                    )));
                }
            },
        };
        let mentioned = parse_mentions(&room.members, &member.id, text);
        let addressed = !mentioned.is_empty();
        let mentioned_ids: Vec<String> = mentioned
            .iter()
            .map(|target| target.member_id.clone())
            .collect();
        // 时间线标签只记显式点名（也就是收窄后的投递对象）；不点名时不刷一排全体标签。
        // 投递对象与用户侧 room_broadcast 共用 chat_targets 同一把尺：点名收窄，不点名发给全体。
        let recipients = chat_targets(room, &mentioned_ids, Some(&member.id));
        let message_id = room.push_member(
            &member.id,
            text.to_string(),
            mentioned_ids.clone(),
            None,
            quoted.as_ref().map(|message| message.id.clone()),
            now,
        );
        let reply_preview = quoted.as_ref().map(|message| {
            let author = match message.kind {
                MessageKind::User => "用户".to_string(),
                MessageKind::System => "系统".to_string(),
                MessageKind::Member => room
                    .members
                    .iter()
                    .find(|candidate| candidate.id == message.author)
                    .map(|candidate| candidate.role.clone())
                    .unwrap_or_else(|| "（已移除的成员）".to_string()),
            };
            format!(
                "（回复 [{}] {}：「{}」）",
                short_msg_id(&message.id),
                author,
                summarize_long(&message.text)
            )
        });
        let outcome = crate::collab::SayOutcome {
            room_id: room.id.clone(),
            room_name: room.name.clone(),
            sender_role: member.role.clone(),
            addressed,
            recipients,
            message_id,
            mentioned: mentioned_ids,
            reply_preview,
        };
        save(&inner)?;
        Ok(outcome)
    }

    /// 成员给房间里某条消息点表情（`belfry room react` 的落点）。
    /// 同一人同一表情再点一次即取消——切换语义让状态有界，不需要额外限速。
    pub fn member_react(
        &self,
        tab_id: &str,
        room_hint: Option<&str>,
        message_hint: &str,
        emoji: &str,
    ) -> Result<crate::collab::ReactOutcome, AppError> {
        let mut inner = self.lock()?;
        let index = resolve_my_room(&inner, tab_id, room_hint)?;
        let room = &mut inner.rooms[index];
        let member = room
            .members
            .iter()
            .find(|member| member.tab_id == tab_id && member.left_at.is_none())
            .map(|member| member.id.clone())
            .ok_or_else(|| AppError::invalid_argument("你不在这间房里"))?;
        let outcome = react_in_room(room, &member, message_hint, emoji)?;
        save(&inner)?;
        Ok(outcome)
    }

    /// 用户（界面）给房间里某条消息点表情；与成员同一条切换逻辑。
    pub fn user_react(
        &self,
        room_id: &str,
        message_hint: &str,
        emoji: &str,
    ) -> Result<Room, AppError> {
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        react_in_room(room, "user", message_hint, emoji)?;
        let snapshot = room.clone();
        save(&inner)?;
        Ok(snapshot)
    }

    /// 撤回自己刚发的一条群聊消息。
    ///
    /// 只动时间线：还没送出的投递由调用方从板上撤掉（`TaskBoard::drop_pending_message`）；
    /// 已经进过成员终端的撤不回来——界面按 `delivered_to` 如实标注，绝不假装没发生过。
    /// 派活消息不走这里：它有任务在跑，要停就在右栏停任务。
    pub fn recall_message(
        &self,
        room_id: &str,
        message_hint: &str,
    ) -> Result<(Room, String), AppError> {
        let mut inner = self.lock()?;
        let room = inner.room_mut(room_id)?;
        let index = room
            .messages
            .iter()
            .position(|message| {
                message.id == message_hint || short_msg_id(&message.id) == message_hint
            })
            .ok_or_else(|| {
                AppError::invalid_argument(format!("没有编号 {message_hint} 的消息"))
            })?;
        let message = &mut room.messages[index];
        if message.recalled_at.is_some() {
            return Err(AppError::invalid_argument("这条消息已经撤回了"));
        }
        if message.kind != MessageKind::User {
            return Err(AppError::invalid_argument("只能撤回自己发的消息"));
        }
        if message.task_id.is_some() {
            return Err(AppError::invalid_argument(
                "派活消息不能撤回；要停就在右栏停掉那条任务",
            ));
        }
        message.recalled_at = Some(now_millis());
        let id = message.id.clone();
        let snapshot = room.clone();
        save(&inner)?;
        Ok((snapshot, id))
    }

    /// 读自己房间里最近的对话（`belfry room log` 的落点）。
    pub fn member_log(
        &self,
        tab_id: &str,
        room_hint: Option<&str>,
        count: usize,
    ) -> Result<crate::collab::LogOutcome, AppError> {
        let inner = self.lock()?;
        let index = resolve_my_room(&inner, tab_id, room_hint)?;
        let room = &inner.rooms[index];
        let roles: HashMap<&str, &str> = room
            .members
            .iter()
            .map(|member| (member.id.as_str(), member.role.as_str()))
            .collect();
        let count = count.clamp(1, 50);
        let lines: Vec<RoomLine> = room
            .messages
            .iter()
            .rev()
            .take(count)
            .rev()
            .map(|message| {
                // 表情回应按计数并排展示：log 是给成员读的，谁点的看界面。
                let mut reactions: Vec<RoomReactionCount> = Vec::new();
                for reaction in &message.reactions {
                    match reactions
                        .iter_mut()
                        .find(|entry| entry.emoji == reaction.emoji)
                    {
                        Some(entry) => entry.count += 1,
                        None => reactions.push(RoomReactionCount {
                            emoji: reaction.emoji.clone(),
                            count: 1,
                        }),
                    }
                }
                // 引用摘录：log 是给成员补课读的，「收到，我按这个改」得说清在回哪句。
                let reply_preview = message.reply_to.as_ref().and_then(|target_id| {
                    room.messages
                        .iter()
                        .find(|candidate| &candidate.id == target_id)
                        .map(|target| {
                            let author = match target.kind {
                                MessageKind::User => "用户".to_string(),
                                MessageKind::System => "系统".to_string(),
                                MessageKind::Member => roles
                                    .get(target.author.as_str())
                                    .map(|role| role.to_string())
                                    .unwrap_or_else(|| "（已离开的成员）".to_string()),
                            };
                            format!(
                                "回复 [{}] {}：「{}」",
                                short_msg_id(&target.id),
                                author,
                                summarize_long(&target.text)
                            )
                        })
                });
                RoomLine {
                    id: short_msg_id(&message.id),
                    author: match message.kind {
                        MessageKind::User => "用户".to_string(),
                        MessageKind::System => "系统".to_string(),
                        MessageKind::Member => roles
                            .get(message.author.as_str())
                            .map(|role| role.to_string())
                            .unwrap_or_else(|| "（已离开的成员）".to_string()),
                    },
                    kind: match message.kind {
                        MessageKind::User => "user",
                        MessageKind::System => "system",
                        MessageKind::Member => "member",
                    }
                    .to_string(),
                    // 撤回了的消息：成员读到的也是如实说明，不是原文——log 是给
                    // 成员补课用的，瞒着它只会让对话对不上。
                    text: if message.recalled_at.is_some() {
                        "（这条消息已撤回）".to_string()
                    } else {
                        message.text.clone()
                    },
                    at: message.at,
                    reactions,
                    reply_preview,
                }
            })
            .collect();
        Ok(crate::collab::LogOutcome {
            room_name: room.name.clone(),
            lines,
        })
    }}

impl Inner {
    fn room_mut(&mut self, id: &str) -> Result<&mut Room, AppError> {
        self.rooms
            .iter_mut()
            .find(|room| room.id == id)
            .ok_or_else(|| AppError::not_found("找不到这个房间"))
    }
}

fn save(inner: &Inner) -> Result<(), AppError> {
    if !inner.writable {
        let reason = inner
            .load_error
            .clone()
            .unwrap_or_else(|| "房间存储当前不可写".to_string());
        return Err(AppError::io(reason));
    }
    let Some(path) = &inner.path else {
        return Err(AppError::io("找不到应用数据目录，房间无法保存。"));
    };
    let file = StoreFile {
        version: STORE_VERSION,
        rooms: inner.rooms.clone(),
    };
    let text = serde_json::to_string_pretty(&file)
        .map_err(|error| AppError::io(format!("房间存储序列化失败：{error}")))?;
    write_atomic(path, &text, false)
}

/// 交差回执可能很长；系统消息里只放一句摘要，原文在任务详情里。
fn summarize_long(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut brief: String = flat.chars().take(80).collect();
    if flat.chars().count() > 80 {
        brief.push('…');
    }
    brief
}

/// 消息的短 id（尾 8 位）：`room log` 展示、`room say --reply` 引用都用它。
pub(crate) fn short_msg_id(id: &str) -> String {
    let chars: Vec<char> = id.chars().collect();
    chars[chars.len().saturating_sub(8)..].iter().collect()
}

fn unique_role(room: &Room, base: &str) -> String {
    let taken: HashSet<&str> = room
        .members
        .iter()
        .filter(|member| member.left_at.is_none())
        .map(|member| member.role.as_str())
        .collect();
    if !taken.contains(base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base} {n}");
        if !taken.contains(candidate.as_str()) {
            return candidate;
        }
        n += 1;
    }
}

/// 任务阶段的中文名。和 `src/rooms/model.ts` 的 `stageMeta` 同一口径——
/// 任意一处改了另一处必须跟着改；store 测试把这张表钉死。
pub(crate) fn stage_label(stage: TaskStage) -> &'static str {
    match stage {
        TaskStage::Dispatching => "排队投递中",
        TaskStage::Running => "进行中",
        TaskStage::Submitted => "已提交待验证",
        TaskStage::Interrupted => "结果未知",
        TaskStage::Verified => "验证通过",
        TaskStage::Rejected => "已退回重做",
        TaskStage::Stopped => "已停止",
        TaskStage::Failed => "有人交不了",
    }
}

/// 从「我在的房间」里选出这一次说话/读话的目标。
fn resolve_my_room(
    inner: &Inner,
    tab_id: &str,
    hint: Option<&str>,
) -> Result<usize, AppError> {
    let mine: Vec<usize> = inner
        .rooms
        .iter()
        .enumerate()
        .filter(|(_, room)| {
            room.members
                .iter()
                .any(|member| member.tab_id == tab_id && member.left_at.is_none())
        })
        .map(|(index, _)| index)
        .collect();
    if mine.is_empty() {
        return Err(AppError::invalid_argument(
            "你不在任何协作房间里——被用户拉进房间之后才有得聊",
        ));
    }
    let Some(hint) = hint.map(str::trim).filter(|hint| !hint.is_empty()) else {
        return if mine.len() == 1 {
            Ok(mine[0])
        } else {
            let names = mine
                .iter()
                .map(|index| inner.rooms[*index].name.as_str())
                .collect::<Vec<_>>()
                .join("、");
            Err(AppError::invalid_argument(format!(
                "你在 {} 间房里，用 --room 写明哪一间：{names}",
                mine.len()
            )))
        };
    };
    let hits: Vec<usize> = mine
        .iter()
        .copied()
        .filter(|index| inner.rooms[*index].name == hint)
        .collect();
    if hits.len() == 1 {
        return Ok(hits[0]);
    }
    let prefix: Vec<usize> = mine
        .iter()
        .copied()
        .filter(|index| inner.rooms[*index].name.starts_with(hint))
        .collect();
    match prefix.len() {
        1 => Ok(prefix[0]),
        0 => Err(AppError::invalid_argument(format!(
            "在你的房间里没找到「{hint}」；用 belfry rooms 看看你在哪几间"
        ))),
        _ => Err(AppError::invalid_argument(format!(
            "有多间房匹配「{hint}」，把名字写全一点"
        ))),
    }
}

/// 表情回应的切换实现：找不到消息、表情不在白名单都当场拒绝。
fn react_in_room(
    room: &mut Room,
    actor_id: &str,
    message_hint: &str,
    emoji: &str,
) -> Result<crate::collab::ReactOutcome, AppError> {
    if !REACTION_EMOJIS.contains(&emoji) {
        return Err(AppError::invalid_argument(format!(
            "只支持这几个表情：{}",
            REACTION_EMOJIS.join(" ")
        )));
    }
    let message = room
        .messages
        .iter_mut()
        .find(|message| message.id == message_hint || short_msg_id(&message.id) == message_hint)
        .ok_or_else(|| {
            AppError::invalid_argument(format!(
                "没有编号 {message_hint} 的消息，用 belfry room log 看看"
            ))
        })?;
    let existing = message
        .reactions
        .iter()
        .position(|reaction| reaction.member_id == actor_id && reaction.emoji == emoji);
    let active = match existing {
        Some(position) => {
            message.reactions.remove(position);
            false
        }
        None => {
            message.reactions.push(RoomReaction {
                member_id: actor_id.to_string(),
                emoji: emoji.to_string(),
                at: now_millis(),
            });
            true
        }
    };
    Ok(crate::collab::ReactOutcome {
        room_id: room.id.clone(),
        room_name: room.name.clone(),
        message_id: message.id.clone(),
        message_short: short_msg_id(&message.id),
        emoji: emoji.to_string(),
        active,
    })
}

/// 用户发言里的点名（`room_broadcast` 用）。用户不是成员，没有可排除的发送者；
/// 只做「谁被点了名」——点名收窄投递（只发给被点者），与成员发言同义。
pub(crate) fn mentions_in(room: &Room, text: &str) -> Vec<crate::collab::MentionTarget> {
    parse_mentions(&room.members, "user", text)
}

/// 群聊投递对象：点名（mentioned 非空）收窄到被点的人；不点名发给全体在场成员。
/// `exclude` 是发送者：成员发言排除自己；用户不在成员表里，传 None 即可。
pub(crate) fn chat_targets(
    room: &Room,
    mentioned: &[String],
    exclude: Option<&str>,
) -> Vec<crate::collab::MentionTarget> {
    room.members
        .iter()
        .filter(|candidate| candidate.left_at.is_none())
        .filter(|candidate| Some(candidate.id.as_str()) != exclude)
        .filter(|candidate| mentioned.is_empty() || mentioned.iter().any(|id| id == &candidate.id))
        .map(|candidate| crate::collab::MentionTarget {
            member_id: candidate.id.clone(),
            tab_id: candidate.tab_id.clone(),
            role: candidate.role.clone(),
        })
        .collect()
}

/// 找出 `@角色` 点名。长角色名先匹配并遮住同段的短名（「前端 2」命中后
/// 「前端」不再重复点名）；点名后面还跟着字母/汉字的算词的一部分，不当点名
/// （避免 `@审查员` 误点「审查」）。
fn parse_mentions(
    members: &[RoomMember],
    sender_id: &str,
    text: &str,
) -> Vec<crate::collab::MentionTarget> {
    let mut candidates: Vec<&RoomMember> = members
        .iter()
        .filter(|member| member.left_at.is_none() && member.id != sender_id)
        .collect();
    candidates.sort_by_key(|member| std::cmp::Reverse(member.role.chars().count()));
    let mut found: Vec<crate::collab::MentionTarget> = Vec::new();
    // 已被更长角色名占用的字节区间：`@前端 2` 命中后，`@前端` 在同一段上
    // 不再重复点名——注释里说好的「长角色名先匹配」要真的遮住短名。
    let mut spans: Vec<(usize, usize)> = Vec::new();
    for member in candidates {
        let needle = format!("@{}", member.role);
        let mut from = 0usize;
        while let Some(at) = text[from..].find(&needle) {
            let start = from + at;
            let end = start + needle.len();
            let boundary = text[end..]
                .chars()
                .next()
                .map_or(true, |ch| !ch.is_alphanumeric());
            let shadowed = spans
                .iter()
                .any(|(span_start, span_end)| start < *span_end && *span_start < end);
            if boundary && !shadowed {
                spans.push((start, end));
                found.push(crate::collab::MentionTarget {
                    member_id: member.id.clone(),
                    tab_id: member.tab_id.clone(),
                    role: member.role.clone(),
                });
                break;
            }
            from = end;
        }
    }
    found.sort_by_key(|target| {
        text.find(&format!("@{}", target.role)).unwrap_or(usize::MAX)
    });
    found
}

/// 一间房一分钟最多 12 条。进程内记忆：重启清空，聊天不值得为它落盘。
fn say_rate_guard(room_id: &str, member_id: &str, now: i64) -> Result<(), AppError> {
    static RECENT: std::sync::OnceLock<
        Mutex<HashMap<(String, String), Vec<i64>>>,
    > = std::sync::OnceLock::new();
    let recent = RECENT.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = recent
        .lock()
        .map_err(|_| AppError::io("发言记录锁不上，请重启应用后重试。"))?;
    let stamps = guard
        .entry((room_id.to_string(), member_id.to_string()))
        .or_default();
    stamps.retain(|at| now - *at < 60_000);
    if stamps.len() >= 12 {
        return Err(AppError::invalid_argument(
            "说太快了：一间房里一分钟最多 12 条，歇一下再说",
        ));
    }
    stamps.push(now);
    Ok(())
}

/// 成员视角的房间目录（`belfry rooms` 的数据源）。
///
/// 只报「值得留意」的活：进行中、待验证、等重派。已验证 / 已退回 / 已停止的
/// 不进这份清单——它们已经结账，成员不必为它们分心。
impl crate::collab::RoomDirectory for RoomStore {
    fn note_delegation(
        &self,
        room_id: Option<&str>,
        from_tab: &str,
        to_tab: &str,
        bus_task_id: &str,
        text: &str,
        announce: bool,
    ) {
        // 登记失败不该挡住投递：这是增强，漏掉的一笔由后续行为兜底。
        let _ = self.record_delegation(room_id, from_tab, to_tab, bus_task_id, text, announce);
    }

    fn say(
        &self,
        tab_id: &str,
        room: Option<&str>,
        text: &str,
        reply_to: Option<&str>,
    ) -> Result<crate::collab::SayOutcome, String> {
        self.member_say(tab_id, room, text, reply_to)
            .map_err(|err| err.message.clone())
    }

    fn react(
        &self,
        tab_id: &str,
        room: Option<&str>,
        message: &str,
        emoji: &str,
    ) -> Result<crate::collab::ReactOutcome, String> {
        self.member_react(tab_id, room, message, emoji)
            .map_err(|err| err.message.clone())
    }

    fn log(
        &self,
        tab_id: &str,
        room: Option<&str>,
        count: usize,
    ) -> Result<crate::collab::LogOutcome, String> {
        self.member_log(tab_id, room, count)
            .map_err(|err| err.message.clone())
    }

    fn my_rooms(&self, tab_id: &str) -> Vec<RoomBrief> {
        let Ok(inner) = self.lock() else {
            return Vec::new();
        };
        inner
            .rooms
            .iter()
            .filter_map(|room| {
                let me = room
                    .members
                    .iter()
                    .find(|member| member.tab_id == tab_id && member.left_at.is_none())?;
                let roles: HashMap<&str, &str> = room
                    .members
                    .iter()
                    .map(|member| (member.id.as_str(), member.role.as_str()))
                    .collect();
                Some(RoomBrief {
                    name: room.name.clone(),
                    my_role: me.role.clone(),
                    members: room
                        .members
                        .iter()
                        .filter(|member| member.left_at.is_none())
                        .map(|member| member.role.clone())
                        .collect(),
                    tasks: room
                        .tasks
                        .iter()
                        .filter(|task| {
                            matches!(
                                task.stage,
                                TaskStage::Dispatching
                                    | TaskStage::Running
                                    | TaskStage::Submitted
                                    | TaskStage::Interrupted
                            )
                        })
                        .map(|task| RoomTaskBrief {
                            title: task.title.clone(),
                            stage: stage_label(task.stage).to_string(),
                            receivers: task
                                .member_ids
                                .iter()
                                .map(|member_id| {
                                    roles
                                        .get(member_id.as_str())
                                        .map(|role| role.to_string())
                                        .unwrap_or_else(|| "（已移除的成员）".to_string())
                                })
                                .collect(),
                        })
                        .collect(),
                })
            })
            .collect()
    }
}
