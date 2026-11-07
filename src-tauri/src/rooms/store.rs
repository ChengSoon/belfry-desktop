//! 房间的持久化：`rooms/rooms.json`（房间、成员、简报、任务板）+ 每间房一份消息账本。
//!
//! 每个动作都在房间的副本上做：动作报错时副本直接丢掉，存储里的房间一个字没动；
//! 动作成功才落盘——先追加账本、再原子替换 rooms.json，最后换上新副本。
//! 文件读不出来或版本不认识时只读运行，不覆盖现场。

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use super::ledger;
use super::model::*;
use super::ops::Posted;
use crate::atomic::{read_text_optional, write_atomic};
use crate::collab::RoomPost;
use crate::collab::task::{TaskBoard, TaskOrigin, TaskState};
use crate::terminal::AppError;

pub const STORE_VERSION: u32 = 1;

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreFile {
    version: u32,
    rooms: Vec<Room>,
}

struct Inner {
    rooms: Vec<Room>,
    /// `<应用数据>/rooms`；None＝拿不到数据目录。
    root: Option<PathBuf>,
    writable: bool,
    load_error: Option<String>,
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
    }
}

/// 把动作产出的消息翻成逐位成员的投递。发给用户的不投（用户在界面上看）。
pub fn deliveries(room: &Room, posted: &[Posted]) -> Vec<RoomPost> {
    let mut out = Vec::new();
    for item in posted {
        let Some(message) = room.messages.iter().find(|message| message.id == item.message_id) else {
            continue;
        };
        let mut line = format!("[{}] {}：{}", short_id(&message.id), room.label(&message.by), message.text);
        if let Some(original) = message.reply_to.as_ref().and_then(|id| room.message(id)) {
            line.push_str(&format!(
                "（回复 [{}] {}：「{}」）",
                short_id(&original.id),
                room.label(&original.by),
                excerpt(&original.text, 60)
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
            let duty = if member.duty.is_empty() { "未写职责" } else { member.duty.as_str() };
            format!("{}（{duty}，手上 {} 件）", member.title, workload(room, &member.id))
        })
        .collect();
    if peers.is_empty() {
        return None;
    }
    Some(format!(
        "可以派活的成员：{}。先拆成任务派出去：belfry room task add <标题> --to <角色>",
        peers.join("、")
    ))
}

impl RoomStore {
    pub fn load(root: Option<PathBuf>) -> Self {
        let readonly = |message: String| Inner { rooms: Vec::new(), root: None, writable: false, load_error: Some(message) };
        let inner = match root {
            None => readonly("找不到应用数据目录，房间无法保存。".to_string()),
            Some(root) => match load_rooms(&root) {
                Ok(rooms) => Inner { rooms, root: Some(root), writable: true, load_error: None },
                Err(message) => readonly(message),
            },
        };
        Self { inner: Mutex::new(inner) }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Inner>, AppError> {
        self.inner.lock().map_err(|_| AppError::io("房间存储锁不上，请重启应用后重试。"))
    }

    pub fn list(&self) -> Result<RoomsView, AppError> {
        let inner = self.lock()?;
        Ok(RoomsView { rooms: inner.rooms.iter().map(summarize).collect(), load_error: inner.load_error.clone() })
    }

    pub fn get(&self, id: &str) -> Result<Room, AppError> {
        let inner = self.lock()?;
        inner.rooms.iter().find(|room| room.id == id).cloned().ok_or_else(|| AppError::not_found("找不到这个房间"))
    }

    pub fn create(&self, name: &str, project_root: &str, objective: &str) -> Result<Room, AppError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::invalid_argument("房间名是必填的"));
        }
        if name.chars().count() > super::ops::MAX_ROOM_NAME_CHARS {
            return Err(AppError::invalid_argument("房间名最多 40 个字"));
        }
        if project_root.trim().is_empty() {
            return Err(AppError::invalid_argument("房间要挂在一个项目上"));
        }
        let now = now_millis();
        let room = Room {
            id: new_id(),
            name: name.to_string(),
            project_root: project_root.trim().to_string(),
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
            messages: Vec::new(),
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
            return Err(AppError::not_found("找不到这个房间"));
        }
        persist(&mut inner, rooms)?;
        // rooms.json 已经落盘；账本删不掉只是残留文件，不回滚删除。
        if let Some(root) = &inner.root
            && let Ok(path) = ledger::path(root, id)
            && let Err(err) = std::fs::remove_file(&path)
            && err.kind() != std::io::ErrorKind::NotFound
        {
            eprintln!("[belfry] 删不掉已删除房间的消息账本 {}：{err}", path.display());
        }
        Ok(())
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
            .ok_or_else(|| AppError::not_found("找不到这个房间"))?;
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
        let member = room.member_by_tab(tab_id).cloned().ok_or("你不在这间房里")?;
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
        let member = room.member_by_tab(tab_id).ok_or("你不在这间房里")?;
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
            .filter(|task| task.chat.is_some() && task.state == TaskState::Dispatched)
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
                touched |= super::ops::record_delivery(room, message_id, &member_id, now);
            }
        }
        if touched {
            persist(&mut inner, rooms)?;
        }
        for task in delivered {
            board.remove(&task.id);
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

/// 先追加各间房排队的账本事件，再写 rooms.json，最后才换进内存。任一步失败，
/// 内存保持原样；已经追加的事件在重放时按 id 幂等，不会重复出现。
fn persist(inner: &mut Inner, mut rooms: Vec<Room>) -> Result<(), AppError> {
    if !inner.writable {
        return Err(AppError::io(inner.load_error.clone().unwrap_or_else(|| "房间存储当前不可写".to_string())));
    }
    let root = inner.root.clone().ok_or_else(|| AppError::io("找不到应用数据目录，房间无法保存。"))?;
    for room in &mut rooms {
        if !room.pending.is_empty() {
            ledger::append(&ledger::path(&root, &room.id)?, &room.pending)?;
            room.pending.clear();
        }
    }
    let file = StoreFile {
        version: STORE_VERSION,
        rooms: rooms.iter().map(|room| Room { messages: Vec::new(), ..room.clone() }).collect(),
    };
    let text = serde_json::to_string_pretty(&file)
        .map_err(|error| AppError::io(format!("房间存储序列化失败：{error}")))?;
    write_atomic(&root.join("rooms.json"), &text, false)?;
    inner.rooms = rooms;
    Ok(())
}

fn load_rooms(root: &Path) -> Result<Vec<Room>, String> {
    let text = read_text_optional(&root.join("rooms.json")).map_err(|err| format!("房间存储读取失败：{}", err.message))?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let file: StoreFile = serde_json::from_str(&text).map_err(|error| format!("房间存储解析失败：{error}；已按只读处理。"))?;
    if file.version != STORE_VERSION {
        return Err(format!(
            "房间存储版本是 {}，当前版本只认识 {STORE_VERSION}；已按只读处理，请在更新前保留原文件。",
            file.version
        ));
    }
    let mut rooms = file.rooms;
    for room in &mut rooms {
        let path = ledger::path(root, &room.id).map_err(|err| err.message)?;
        for event in ledger::read(&path).map_err(|err| format!("房间消息账本读取失败：{}", err.message))? {
            ledger::apply(room, &event);
        }
    }
    Ok(rooms)
}

fn resolve_my_room(rooms: &[Room], tab_id: &str, hint: Option<&str>) -> Result<usize, String> {
    let mine: Vec<usize> = rooms
        .iter()
        .enumerate()
        .filter(|(_, room)| room.member_by_tab(tab_id).is_some())
        .map(|(index, _)| index)
        .collect();
    if mine.is_empty() {
        return Err("你不在任何协作房间里——被用户拉进房间之后才能用 belfry room".to_string());
    }
    let Some(hint) = hint.map(str::trim).filter(|hint| !hint.is_empty()) else {
        if mine.len() == 1 {
            return Ok(mine[0]);
        }
        let names = mine.iter().map(|index| rooms[*index].name.as_str()).collect::<Vec<_>>().join("、");
        return Err(format!("你在 {} 间房里，用 --room 写明哪一间：{names}", mine.len()));
    };
    if let Some(index) = mine.iter().copied().find(|index| rooms[*index].name == hint) {
        return Ok(index);
    }
    let prefixed: Vec<usize> = mine.iter().copied().filter(|index| rooms[*index].name.starts_with(hint)).collect();
    match prefixed.as_slice() {
        [index] => Ok(*index),
        [] => Err(format!("你的房间里没有「{hint}」；用 belfry rooms 看看你在哪几间")),
        _ => Err(format!("有多间房匹配「{hint}」，把名字写全一点")),
    }
}
