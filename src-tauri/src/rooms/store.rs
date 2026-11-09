//! 房间的持久化：`rooms/rooms.json`（房间、成员、简报、任务板）+ 每间房一份消息账本。
//!
//! 每个动作都在房间的副本上做：动作报错时副本直接丢掉，存储里的房间一个字没动；
//! rooms.json 中的账本字节游标是唯一提交点；失败追加的尾部不会被恢复或投递。
//! 文件读不出来或版本不认识时只读运行，不覆盖现场。

use std::path::{Path, PathBuf};
use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use super::attachments;
use super::ledger;
use super::model::*;
use super::ops::Posted;
use crate::atomic::{read_text_optional, write_atomic, FileLock};
use crate::collab::RoomPost;
use crate::collab::task::{TaskBoard, TaskOrigin, DeliveryPhase};
use crate::resource::canonicalize;
use crate::terminal::AppError;

pub const STORE_VERSION: u32 = 3;

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreFile {
    version: u32,
    rooms: Vec<Room>,
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    ledger_lengths: BTreeMap<String, u64>,
}

struct Inner {
    rooms: Vec<Room>,
    /// `<应用数据>/rooms`；None＝拿不到数据目录。
    root: Option<PathBuf>,
    writable: bool,
    load_error: Option<String>,
    revision: u64,
    ledger_lengths: BTreeMap<String, u64>,
}

pub struct RoomStore {
    inner: Mutex<Inner>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSummary {
    pub id: String,
    pub name: String,
    pub project_root: String,
    pub created_at: i64,
    pub objective: String,
    pub member_count: usize,
    /// 在场成员的会话：前端把它们从侧栏与 Quick Open 里藏起来，只在房间里露面。
    pub member_tab_ids: Vec<String>,
    /// 与 `member_tab_ids` 一一对应的角色名：通知里写「哪个角色在等你」。
    pub member_titles: Vec<String>,
    pub foreman: Option<String>,
    pub open_tasks: usize,
    pub done_tasks: usize,
    pub last_message_at: Option<i64>,
    pub paused: bool,
    pub ledger_bytes: u64,
    /// 最近一条发给你的消息（统筹汇报、成员找你）。界面拿它画未读、发系统通知。
    pub last_to_user: Option<InboxNote>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxNote {
    pub id: String,
    pub at: i64,
    /// 发件人的角色名。
    pub from: String,
    /// 正文摘录（只有附件时列出文件名）。
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomsView {
    pub rooms: Vec<RoomSummary>,
    pub load_error: Option<String>,
}

fn summarize(room: &Room) -> RoomSummary {
    RoomSummary {
        id: room.id.clone(),
        name: room.name.clone(),
        project_root: room.project_root.clone(),
        created_at: room.created_at,
        objective: room.brief.objective.clone(),
        member_count: room.active_members().count(),
        member_tab_ids: room.active_members().map(|member| member.tab_id.clone()).collect(),
        member_titles: room.active_members().map(|member| member.title.clone()).collect(),
        foreman: room.foreman().map(|member| member.title.clone()),
        open_tasks: room
            .tasks
            .iter()
            .filter(|task| matches!(task.status, TaskStatus::Planned | TaskStatus::Active))
            .count(),
        done_tasks: room.tasks.iter().filter(|task| task.status == TaskStatus::Done).count(),
        last_message_at: room.messages.last().map(|message| message.at),
        paused: room.paused,
        ledger_bytes: room.ledger_bytes,
        last_to_user: room
            .messages
            .iter()
            .rev()
            .find(|message| message.kind == MessageKind::Chat && message.by != "user" && message.to.iter().any(|id| id == "user"))
            .map(|message| InboxNote {
                id: message.id.clone(),
                at: message.at,
                from: room.label(&message.by),
                text: excerpt(&attachments::summary(&message.text, &message.attachments), 80),
            }),
    }
}

/// 把动作产出的消息翻成逐位成员的投递。发给用户的不投（用户在界面上看）。
pub fn deliveries(room: &Room, posted: &[Posted]) -> Vec<RoomPost> {
    // 暂停的房间：消息照样记在时间线上，只是不送进终端。
    if room.paused {
        return Vec::new();
    }
    let mut out = Vec::new();
    for item in posted {
        let Some(message) = room.message(&item.message_id) else {
            continue;
        };
        let body = attachments::instruction(&message.text, &message.attachments);
        let mut line = format!("[{}] {}：{body}", short_id(&message.id), room.label(&message.by));
        if let Some(original) = message.reply_to.as_ref().and_then(|id| room.message(id)) {
            line.push_str(&belfry_i18n::lformat!(
                "（回复 [{}] {}：「{}」）",
                short_id(&original.id),
                room.label(&original.by),
                excerpt(&attachments::summary(&original.text, &original.attachments), 60)
            ));
        }
        for member_id in &item.to {
            if let Some(member) = room.active_member(member_id) {
                let line = match roster_hint(room, message, member) {
                    Some(hint) => format!("{line}\n{hint}"),
                    None => line.clone(),
                };
                out.push(RoomPost {
                    room_id: room.id.clone(),
                    room_name: room.name.clone(),
                    message_id: message.id.clone(),
                    member_title: member.title.clone(),
                    tab_id: member.tab_id.clone(),
                    line,
                    ask: message.mode == MessageMode::RequestReply,
                });
            }
        }
    }
    out
}

/// 用户发给统筹的消息，附上成员名单：统筹读到需求的那一刻就看得见可以派给谁。
fn roster_hint(room: &Room, message: &Message, recipient: &Member) -> Option<String> {
    if recipient.role != MemberRole::Foreman || message.by != "user" || message.kind != MessageKind::Chat {
        return None;
    }
    let peers: Vec<String> = room
        .active_members()
        .filter(|member| member.role == MemberRole::Peer)
        .map(|member| {
            let duty = if member.duty.is_empty() { belfry_i18n::text("未写职责") } else { member.duty.as_str() };
            belfry_i18n::lformat!("{}（{duty}，手上 {} 件）", member.title, workload(room, &member.id))
        })
        .collect();
    if peers.is_empty() {
        return None;
    }
    Some(belfry_i18n::lformat!(
        "可以派活的成员：{}。先拆成任务派出去：belfry room task add <标题> --to <角色>",
        peers.join("、")
    ))
}

impl RoomStore {
    pub fn load(root: Option<PathBuf>) -> Self {
        let readonly = |message: String| Inner { rooms: Vec::new(), root: None, writable: false, load_error: Some(message), revision: 0, ledger_lengths: BTreeMap::new() };
        let inner = match root {
            None => readonly(belfry_i18n::text("找不到应用数据目录，房间无法保存。").to_string()),
            Some(root) => match load_rooms(&root) {
                Ok(file) => Inner { rooms: file.rooms, root: Some(root), writable: true, load_error: None, revision: file.revision, ledger_lengths: file.ledger_lengths },
                Err(message) => readonly(message),
            },
        };
        Self { inner: Mutex::new(inner) }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Inner>, AppError> {
        self.inner.lock().map_err(|_| AppError::io(belfry_i18n::text("房间存储锁不上，请重启应用后重试。")))
    }

    pub fn list(&self) -> Result<RoomsView, AppError> {
        let inner = self.lock()?;
        Ok(RoomsView { rooms: inner.rooms.iter().map(summarize).collect(), load_error: inner.load_error.clone() })
    }

    pub fn get(&self, id: &str) -> Result<Room, AppError> {
        let inner = self.lock()?;
        inner.rooms.iter().find(|room| room.id == id).cloned().ok_or_else(|| AppError::not_found(belfry_i18n::text("找不到这个房间")))
    }

    pub fn history(&self, id: &str, cursor: Option<&str>, limit: Option<usize>) -> Result<super::history::HistoryPage, AppError> {
        let inner = self.lock()?;
        let room = inner.rooms.iter().find(|room| room.id == id).ok_or_else(|| AppError::not_found(belfry_i18n::text("找不到这个房间")))?;
        let root = inner.root.as_ref().ok_or_else(|| AppError::io(belfry_i18n::text("房间存储当前不可读")))?;
        super::history::read_page(&ledger::path(root, &room.id)?, room.ledger_bytes, cursor, limit)
    }

    pub fn create(&self, name: &str, project_root: &str, objective: &str) -> Result<Room, AppError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::invalid_argument(belfry_i18n::text("房间名是必填的")));
        }
        if name.chars().count() > super::ops::MAX_ROOM_NAME_CHARS {
            return Err(AppError::invalid_argument("房间名最多 40 个字"));
        }
        if project_root.trim().is_empty() {
            return Err(AppError::invalid_argument(belfry_i18n::text("房间要挂在一个项目上")));
        }
        // 与 project::service::open_project 一致：解析相对路径和链接后检查目录。
        // 只校验新房间，不在加载或保存已有房间时改写历史项目地址。
        let requested = Path::new(project_root.trim());
        let project_root = canonicalize(requested).map_err(|_| {
            AppError::not_found(format!("Room project directory was not found: {}", requested.display()))
        })?;
        if !project_root.is_dir() {
            return Err(AppError::invalid_argument(format!(
                "Room project path must point to a directory: {}", requested.display()
            )));
        }
        let now = now_millis();
        let room = Room {
            id: new_id(),
            name: name.to_string(),
            project_root: project_root.to_string_lossy().into_owned(),
            created_at: now,
            brief: Brief {
                objective: objective.trim().to_string(),
                updated_by: Some("user".to_string()),
                updated_at: Some(now),
                ..Brief::default()
            },
            members: Vec::new(),
            tasks: Vec::new(),
            next_task: 1,
            idle_nudged_after: None,
            paused: false,
            messages: Vec::new(),
            retained_messages: Vec::new(),
            delivery_outbox: Vec::new(),
            ledger_bytes: 0,
            pending: Vec::new(),
        };
        let mut inner = self.lock()?;
        let mut rooms = inner.rooms.clone();
        rooms.push(room.clone());
        persist(&mut inner, rooms)?;
        Ok(room)
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let mut inner = self.lock()?;
        let rooms: Vec<Room> = inner.rooms.iter().filter(|room| room.id != id).cloned().collect();
        if rooms.len() == inner.rooms.len() {
            return Err(AppError::not_found(belfry_i18n::text("找不到这个房间")));
        }
        persist(&mut inner, rooms)?;
        // rooms.json 已经落盘；账本和附件删不掉只是残留文件，不回滚删除。
        if let Some(root) = &inner.root {
            if let Ok(path) = ledger::path(root, id)
                && let Err(err) = std::fs::remove_file(&path)
                && err.kind() != std::io::ErrorKind::NotFound
            {
                log::warn!("[belfry] 删不掉已删除房间的消息账本 {}：{err}", path.display());
            }
            if let Ok(dir) = attachments::room_directory(root, id)
                && let Err(err) = std::fs::remove_dir_all(&dir)
                && err.kind() != std::io::ErrorKind::NotFound
            {
                log::warn!("[belfry] 删不掉已删除房间的附件 {}：{err}", dir.display());
            }
        }
        Ok(())
    }

    /// 一间房的附件目录（不存在的房间报错）。导入、校验附件都从这里起步。
    pub(super) fn attachment_directory(&self, room_id: &str) -> Result<PathBuf, AppError> {
        let inner = self.lock()?;
        if !inner.rooms.iter().any(|room| room.id == room_id) {
            return Err(AppError::not_found(belfry_i18n::text("找不到这个房间")));
        }
        let root = inner.root.as_ref().ok_or_else(|| AppError::io(belfry_i18n::text("找不到附件存储目录")))?;
        attachments::room_directory(root, room_id)
    }

    /// 丢掉一个还没发出去的附件。已经随消息发出的不删：迟到的清理不能删掉别人能看到的文件。
    pub(super) fn discard_attachment(&self, room_id: &str, attachment_id: &str) -> Result<(), AppError> {
        let inner = self.lock()?;
        let room = inner.rooms.iter().find(|room| room.id == room_id)
            .ok_or_else(|| AppError::not_found(belfry_i18n::text("找不到这个房间")))?;
        if room.all_messages().flat_map(|message| &message.attachments).any(|attachment| attachment.id == attachment_id) {
            return Ok(());
        }
        let root = inner.root.as_ref().ok_or_else(|| AppError::io(belfry_i18n::text("找不到附件存储目录")))?;
        attachments::discard(&attachments::room_directory(root, room_id)?, attachment_id)
    }

    /// 在一间房上做一个动作。`f` 报错时什么都不落盘。
    pub fn mutate<T>(
        &self,
        room_id: &str,
        f: impl FnOnce(&mut Room) -> Result<T, String>,
    ) -> Result<(T, Room), AppError> {
        let mut inner = self.lock()?;
        let index = inner
            .rooms
            .iter()
            .position(|room| room.id == room_id)
            .ok_or_else(|| AppError::not_found(belfry_i18n::text("找不到这个房间")))?;
        let mut room = inner.rooms[index].clone();
        let value = f(&mut room).map_err(AppError::invalid_argument)?;
        let snapshot = commit(&mut inner, index, room)?;
        Ok((value, snapshot))
    }

    /// 成员（CLI）在自己的房间上做一个动作。`hint` 是房间名或前缀；只在一间房里时可省略。
    pub fn mutate_as_member<T>(
        &self,
        tab_id: &str,
        hint: Option<&str>,
        f: impl FnOnce(&mut Room, &Member) -> Result<T, String>,
    ) -> Result<(T, Room), String> {
        let mut inner = self.lock().map_err(|err| err.message)?;
        let index = resolve_my_room(&inner.rooms, tab_id, hint)?;
        let mut room = inner.rooms[index].clone();
        let member = room.member_by_tab(tab_id).cloned().ok_or(belfry_i18n::text("你不在这间房里"))?;
        let value = f(&mut room, &member)?;
        let snapshot = commit(&mut inner, index, room).map_err(|err| err.message)?;
        Ok((value, snapshot))
    }

    /// 成员只读地看自己的房间。
    pub fn read_as_member<T>(
        &self,
        tab_id: &str,
        hint: Option<&str>,
        f: impl FnOnce(&Room, &Member) -> T,
    ) -> Result<T, String> {
        let inner = self.lock().map_err(|err| err.message)?;
        let index = resolve_my_room(&inner.rooms, tab_id, hint)?;
        let room = &inner.rooms[index];
        let member = room.member_by_tab(tab_id).ok_or(belfry_i18n::text("你不在这间房里"))?;
        Ok(f(room, member))
    }

    pub fn my_rooms(&self, tab_id: &str) -> Vec<Room> {
        self.lock()
            .map(|inner| inner.rooms.iter().filter(|room| room.member_by_tab(tab_id).is_some()).cloned().collect())
            .unwrap_or_default()
    }

    /// 给安静了一阵、有成员闲着的房间提醒统筹。`session_idle` 按会话 tabId 回答它是不是闲着。
    pub fn nudge_idle(&self, session_idle: &dyn Fn(&str) -> bool, now: i64) -> Result<Vec<RoomPost>, AppError> {
        let mut inner = self.lock()?;
        if !inner.writable {
            return Ok(Vec::new());
        }
        let mut rooms = inner.rooms.clone();
        let mut posts = Vec::new();
        for room in &mut rooms {
            if let Some(posted) = super::ops::idle_nudge(room, &|member| session_idle(&member.tab_id), now) {
                posts.extend(deliveries(room, std::slice::from_ref(&posted)));
            }
        }
        if rooms.iter().zip(&inner.rooms).any(|(next, current)| next.idle_nudged_after != current.idle_nudged_after) {
            persist(&mut inner, rooms)?;
        }
        Ok(posts)
    }

    /// 把已经进过成员终端的房间投递记成送达，并从总线上收掉。
    pub fn reconcile(&self, board: &TaskBoard) -> Result<(), AppError> {
        let delivered: Vec<_> = board
            .snapshot()
            .into_iter()
            .filter(|task| task.chat.is_some())
            .filter(|task| matches!(task.origin, Some(TaskOrigin::Room { .. })))
            .collect();
        if delivered.is_empty() {
            return Ok(());
        }
        let now = now_millis();
        let mut inner = self.lock()?;
        let mut touched = false;
        let mut rooms = inner.rooms.clone();
        for task in &delivered {
            let Some(TaskOrigin::Room { id, .. }) = &task.origin else { continue };
            let Some(room) = rooms.iter_mut().find(|room| &room.id == id) else { continue };
            let Some(member_id) = room.members.iter().find(|member| member.tab_id == task.to).map(|member| member.id.clone())
            else {
                continue;
            };
            for message_id in task.chat.iter().flat_map(|chat| chat.message_ids.iter()) {
                if task.delivery.phase == DeliveryPhase::Submitted {
                    touched |= super::ops::record_delivery(room, message_id, &member_id, now);
                    let count = room.delivery_outbox.len();
                    room.delivery_outbox.retain(|entry| entry.message_id != *message_id || entry.member_id != member_id);
                    touched |= count != room.delivery_outbox.len();
                } else if let Some(entry) = room.delivery_outbox.iter_mut().find(|entry| entry.message_id == *message_id && entry.member_id == member_id) {
                    if entry.phase != task.delivery.phase || entry.message != task.delivery.message {
                        entry.phase = task.delivery.phase;
                        entry.message = task.delivery.message.clone();
                        touched = true;
                    }
                }
            }
        }
        if touched {
            persist(&mut inner, rooms)?;
        }
        for task in delivered.into_iter().filter(|task| matches!(task.delivery.phase, DeliveryPhase::Submitted | DeliveryPhase::Cancelled)) {
            board.remove(&task.id).map_err(AppError::io)?;
        }
        Ok(())
    }

    /// 房间状态提交后、总线受理前崩溃，仍能从同一次房间提交的 outbox 恢复。
    pub fn pump_outbox(&self, board: &TaskBoard, registry: &crate::collab::SessionRegistry) -> Result<(), AppError> {
        self.reconcile(board)?;
        let posts = {
            let inner = self.lock()?;
            inner.rooms.iter().flat_map(|room| {
                let posted: Vec<_> = room.delivery_outbox.iter()
                    .filter(|entry| matches!(entry.phase, DeliveryPhase::Accepted | DeliveryPhase::Queued))
                    .map(|entry| Posted { message_id: entry.message_id.clone(), to: vec![entry.member_id.clone()] }).collect();
                deliveries(room, &posted)
            }).collect::<Vec<_>>()
        };
        self.enqueue_posts(board, registry, &posts)
    }

    /// 在房间锁内复查 outbox 后受理。另一线程提交回执并清理总线后，旧投递快照不能重新入队。
    pub fn enqueue_posts(&self, board: &TaskBoard, registry: &crate::collab::SessionRegistry, posts: &[RoomPost]) -> Result<(), AppError> {
        let inner = self.lock()?;
        for post in posts {
            let Some(room) = inner.rooms.iter().find(|room| room.id == post.room_id && !room.paused) else { continue };
            let Some(member) = room.member_by_tab(&post.tab_id) else { continue };
            if room.delivery_outbox.iter().any(|entry| entry.message_id == post.message_id && entry.member_id == member.id
                && matches!(entry.phase, DeliveryPhase::Accepted | DeliveryPhase::Queued))
                && registry.find(&post.tab_id).is_some() {
                crate::collab::task::enqueue_room_post(board, &format!("room:{}", post.room_id), post, now_millis()).map_err(AppError::io)?;
            }
        }
        Ok(())
    }
}

/// 换上改好的房间并落盘。
fn commit(inner: &mut Inner, index: usize, room: Room) -> Result<Room, AppError> {
    let mut rooms = inner.rooms.clone();
    rooms[index] = room;
    persist(inner, rooms)?;
    Ok(inner.rooms[index].clone())
}

/// 追加内容先同步到磁盘，最后用 rooms.json 一次性提交所有账本游标和任务状态。
/// 失败尾部仍在文件里，但恢复只读旧游标；下一次写入先裁掉该未提交尾部。
fn persist(inner: &mut Inner, mut rooms: Vec<Room>) -> Result<(), AppError> {
    if !inner.writable {
        return Err(AppError::io(inner.load_error.clone().unwrap_or_else(|| belfry_i18n::text("房间存储当前不可写").to_string())));
    }
    let root = inner.root.clone().ok_or_else(|| AppError::io(belfry_i18n::text("找不到应用数据目录，房间无法保存。")))?;
    let _writer = FileLock::acquire(&root.join("store.lock"))?;
    let disk = read_store(&root).map_err(AppError::io)?;
    if disk.revision != inner.revision || disk.version != STORE_VERSION {
        return Err(AppError::io(belfry_i18n::text("房间已被另一应用实例更新，请重新加载后再操作；本次修改未提交。")));
    }
    let mut lengths = inner.ledger_lengths.clone();
    for room in &mut rooms {
        let path = ledger::path(&root, &room.id)?;
        let previous = lengths.get(&room.id).copied().unwrap_or(0);
        if !room.pending.is_empty() {
            ledger::discard_uncommitted(&path, previous)?;
            injected_failure("append")?;
            ledger::append(&path, &room.pending)?;
            injected_failure("sync")?;
            room.pending.clear();
            lengths.insert(room.id.clone(), ledger::length(&path)?);
        } else {
            lengths.entry(room.id.clone()).or_insert(previous);
        }
        room.ledger_bytes = lengths[&room.id];
    }
    lengths.retain(|id, _| rooms.iter().any(|room| &room.id == id));
    let revision = inner.revision.checked_add(1).ok_or_else(|| AppError::io(belfry_i18n::text("房间提交版本溢出")))?;
    injected_failure("rename")?;
    write_store(&root, &rooms, revision, &lengths)?;
    inner.rooms = rooms;
    inner.revision = revision;
    inner.ledger_lengths = lengths;
    Ok(())
}

fn write_store(root: &Path, rooms: &[Room], revision: u64, lengths: &BTreeMap<String, u64>) -> Result<(), AppError> {
    let file = StoreFile {
        version: STORE_VERSION,
        revision,
        ledger_lengths: lengths.clone(),
        rooms: rooms.to_vec(),
    };
    let text = serde_json::to_string_pretty(&file)
        .map_err(|error| AppError::io(belfry_i18n::lformat!("房间存储序列化失败：{error}")))?;
    write_atomic(&root.join("rooms.json"), &text, true)
}

fn read_store(root: &Path) -> Result<StoreFile, String> {
    let text = read_text_optional(&root.join("rooms.json")).map_err(|err| belfry_i18n::lformat!("房间存储读取失败：{}", err.message))?;
    if text.trim().is_empty() {
        return Ok(StoreFile { version: STORE_VERSION, ..StoreFile::default() });
    }
    let file: StoreFile = serde_json::from_str(&text).map_err(|error| belfry_i18n::lformat!("房间存储解析失败：{error}；已按只读处理。"))?;
    if !matches!(file.version, 1 | 2 | STORE_VERSION) {
        return Err(belfry_i18n::lformat!(
            "房间存储版本是 {}，当前版本只认识 {STORE_VERSION}；已按只读处理，请在更新前保留原文件。",
            file.version
        ));
    }
    Ok(file)
}

fn load_rooms(root: &Path) -> Result<StoreFile, String> {
    let _writer = FileLock::acquire(&root.join("store.lock")).map_err(|error| error.message)?;
    let mut file = read_store(root)?;
    let migrating = file.version != STORE_VERSION;
    let has_cursors = file.version >= 2;
    for room in &mut file.rooms {
        let path = ledger::path(root, &room.id).map_err(|err| err.message)?;
        let length = if !has_cursors {
            ledger::length(&path).map_err(|error| error.message)?
        } else {
            file.ledger_lengths.get(&room.id).copied().ok_or(belfry_i18n::text("房间缺少账本提交游标，已按只读处理"))?
        };
        file.ledger_lengths.insert(room.id.clone(), length);
        if ledger::length(&path).map_err(|error| error.message)? < length {
            return Err(belfry_i18n::text("消息账本短于已提交游标，已保留现场").into());
        }
        if migrating {
            ledger::visit_committed(&path, length, |event| {
                if event.room_id == room.id { ledger::apply(room, &event); }
            }).map_err(|err| belfry_i18n::lformat!("房间消息账本读取失败：{}", err.message))?;
            room.ledger_bytes = length;
        } else if room.ledger_bytes != length {
            return Err(belfry_i18n::text("房间投影与账本提交游标不一致，已按只读处理").into());
        }
    }
    if migrating {
        // 升级先发布旧状态的提交游标；否则第一次新操作失败后仍会被旧“读全文件”恢复。
        write_store(root, &file.rooms, file.revision, &file.ledger_lengths).map_err(|error| error.message)?;
        file.version = STORE_VERSION;
    }
    Ok(file)
}

#[cfg(test)]
thread_local! { static COMMIT_FAILURE: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) }; }
#[cfg(test)]
pub(super) fn fail_next_commit(stage: &'static str) { COMMIT_FAILURE.set(Some(stage)); }
fn injected_failure(_stage: &str) -> Result<(), AppError> {
    #[cfg(test)]
    if COMMIT_FAILURE.get() == Some(_stage) { COMMIT_FAILURE.set(None); return Err(AppError::io(format!("injected {_stage} failure"))); }
    Ok(())
}

fn resolve_my_room(rooms: &[Room], tab_id: &str, hint: Option<&str>) -> Result<usize, String> {
    let mine: Vec<usize> = rooms
        .iter()
        .enumerate()
        .filter(|(_, room)| room.member_by_tab(tab_id).is_some())
        .map(|(index, _)| index)
        .collect();
    if mine.is_empty() {
        return Err(belfry_i18n::text("你不在任何协作房间里——被用户拉进房间之后才能用 belfry room").to_string());
    }
    let Some(hint) = hint.map(str::trim).filter(|hint| !hint.is_empty()) else {
        if mine.len() == 1 {
            return Ok(mine[0]);
        }
        let names = mine.iter().map(|index| rooms[*index].name.as_str()).collect::<Vec<_>>().join("、");
        return Err(belfry_i18n::lformat!("你在 {} 间房里，用 --room 写明哪一间：{names}", mine.len()));
    };
    if let Some(index) = mine.iter().copied().find(|index| rooms[*index].name == hint) {
        return Ok(index);
    }
    let prefixed: Vec<usize> = mine.iter().copied().filter(|index| rooms[*index].name.starts_with(hint)).collect();
    match prefixed.as_slice() {
        [index] => Ok(*index),
        [] => Err(belfry_i18n::lformat!("你的房间里没有「{hint}」；用 belfry rooms 看看你在哪几间")),
        _ => Err(belfry_i18n::lformat!("有多间房匹配「{hint}」，把名字写全一点")),
    }
}
