//! 界面的 Tauri 命令。用户在界面上的动作和成员在 CLI 里的动作走同一套 `ops`，
//! 区别只在身份：界面上永远是 `Actor::User`（有协调权）。
//!
//! 每个改动都返回改完的整间房：状态真相在 Rust，前端不做乐观更新。

use std::sync::Arc;

use belfry_protocol::RoomTaskOp;
use tauri::State;

use super::attachments;
use super::model::*;
use super::ops::{self, Posted};
use super::store::{deliveries, RoomStore, RoomsView};
use crate::collab::task::{self, TaskBoard};
use crate::collab::SessionRegistry;
use crate::terminal::AppError;

/// 把动作产出的消息排进成员终端。会话已经不在的跳过：消息照样留在时间线上。
fn deliver(board: &TaskBoard, registry: &SessionRegistry, room: &Room, posted: &[Posted]) {
    enqueue(board, registry, deliveries(room, posted));
}

fn enqueue(board: &TaskBoard, registry: &SessionRegistry, posts: Vec<crate::collab::RoomPost>) {
    let now = now_millis();
    for post in posts {
        if registry.find(&post.tab_id).is_some() {
            task::enqueue_room_post(board, &format!("room:{}", post.room_id), &post, now);
        }
    }
}

/// 任务板操作：界面与 CLI 共用这一张分派表。返回动到的任务号与要投递的消息。
pub(super) fn apply_task_op(
    room: &mut Room,
    actor: &Actor,
    op: &RoomTaskOp,
    now: i64,
) -> Result<(String, Vec<Posted>), String> {
    let same = |task: &String, result: Result<Vec<Posted>, String>| result.map(|posted| (task.clone(), posted));
    match op {
        RoomTaskOp::Add { title, outcome, assignee, after } => {
            ops::task_add(room, actor, title, outcome.as_deref(), assignee.as_deref(), after, now)
        }
        RoomTaskOp::Assign { task, assignee } => same(task, ops::task_assign(room, actor, task, assignee, now)),
        RoomTaskOp::Start { task } => same(task, ops::task_start(room, actor, task, now)),
        RoomTaskOp::Done { task, result } => same(task, ops::task_done(room, actor, task, result.as_deref(), now)),
        RoomTaskOp::Reopen { task } => same(task, ops::task_reopen(room, actor, task, now)),
        RoomTaskOp::Note { task, text } => same(task, ops::task_note(room, actor, task, text, now)),
        RoomTaskOp::Archive { task } => same(task, ops::task_archive(room, actor, task, now)),
    }
}

/// 房间列表。应用层每隔几秒拉一次（成员会话的隔离名单靠它），空闲提醒也挂在这一拍上。
#[tauri::command]
pub fn room_list(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
) -> Result<RoomsView, AppError> {
    store.reconcile(&board)?;
    let idle = |tab_id: &str| registry.find(tab_id).is_some_and(|session| session.activity == "idle");
    let posts = store.nudge_idle(&idle, now_millis())?;
    enqueue(&board, &registry, posts);
    store.list()
}

#[tauri::command]
pub fn room_get(store: State<'_, Arc<RoomStore>>, board: State<'_, Arc<TaskBoard>>, id: String) -> Result<Room, AppError> {
    store.reconcile(&board)?;
    store.get(&id)
}

#[tauri::command]
pub fn room_create(
    store: State<'_, Arc<RoomStore>>,
    name: String,
    project_root: String,
    objective: Option<String>,
) -> Result<Room, AppError> {
    store.create(&name, &project_root, objective.as_deref().unwrap_or_default())
}

#[tauri::command]
pub fn room_rename(store: State<'_, Arc<RoomStore>>, id: String, name: String) -> Result<Room, AppError> {
    let (_, room) = store.mutate(&id, |room| {
        let name = name.trim();
        if name.is_empty() {
            return Err("房间名是必填的".to_string());
        }
        if name.chars().count() > ops::MAX_ROOM_NAME_CHARS {
            return Err("房间名最多 40 个字".to_string());
        }
        room.name = name.to_string();
        Ok(())
    })?;
    Ok(room)
}

#[tauri::command]
pub fn room_delete(store: State<'_, Arc<RoomStore>>, board: State<'_, Arc<TaskBoard>>, id: String) -> Result<(), AppError> {
    store.delete(&id)?;
    // 房间没了，还排着队的消息也不该再送出去。
    for queued in board.snapshot() {
        if matches!(&queued.origin, Some(task::TaskOrigin::Room { id: room_id, .. }) if *room_id == id) {
            board.remove(&queued.id);
        }
    }
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn room_add_member(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    tab_id: String,
    agent: String,
    title: String,
    duty: String,
    foreman: Option<bool>,
) -> Result<Room, AppError> {
    let ((_, posted), room) = store.mutate(&id, |room| {
        ops::add_member(room, &tab_id, &agent, &title, &duty, foreman.unwrap_or(false), now_millis())
    })?;
    deliver(&board, &registry, &room, &posted);
    Ok(room)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn room_update_member(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    member_id: String,
    title: Option<String>,
    duty: Option<String>,
    tab_id: Option<String>,
) -> Result<Room, AppError> {
    let (posted, room) = store.mutate(&id, |room| {
        ops::update_member(room, &member_id, title.as_deref(), duty.as_deref(), tab_id.as_deref(), now_millis())
    })?;
    deliver(&board, &registry, &room, &posted);
    Ok(room)
}

#[tauri::command]
pub fn room_set_foreman(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    member_id: String,
) -> Result<Room, AppError> {
    let (posted, room) = store.mutate(&id, |room| ops::set_foreman(room, &member_id, now_millis()))?;
    deliver(&board, &registry, &room, &posted);
    Ok(room)
}

#[tauri::command]
pub fn room_remove_member(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    member_id: String,
) -> Result<Room, AppError> {
    let (posted, room) = store.mutate(&id, |room| ops::remove_member(room, &member_id, now_millis()))?;
    deliver(&board, &registry, &room, &posted);
    Ok(room)
}

#[tauri::command]
pub fn room_update_brief(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    objective: Option<String>,
    focus: Option<String>,
    constraints: Option<Vec<String>>,
) -> Result<Room, AppError> {
    let (posted, room) = store.mutate(&id, |room| {
        ops::update_brief(room, &Actor::User, objective.as_deref(), focus.as_deref(), constraints, now_millis())
    })?;
    deliver(&board, &registry, &room, std::slice::from_ref(&posted));
    Ok(room)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn room_say(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    text: String,
    to: Option<Vec<String>>,
    reply_to: Option<String>,
    ask: Option<bool>,
    attachment_ids: Option<Vec<String>>,
) -> Result<Room, AppError> {
    store.reconcile(&board)?;
    // 先在锁外找齐附件（要读磁盘），落库时在锁内再确认一遍文件还在：丢弃草稿和发送可能同时发生。
    let files = attachments::resolve(&store, &id, &attachment_ids.unwrap_or_default())?;
    let (posted, room) = store.mutate(&id, |room| {
        attachments::validate_existing(&files).map_err(|err| err.message)?;
        ops::say_with(room, &Actor::User, &to.unwrap_or_default(), &text, reply_to.as_deref(), ask.unwrap_or(false), files, now_millis())
    })?;
    deliver(&board, &registry, &room, std::slice::from_ref(&posted));
    Ok(room)
}

#[tauri::command]
pub fn room_set_paused(store: State<'_, Arc<RoomStore>>, id: String, paused: bool) -> Result<Room, AppError> {
    let (_, room) = store.mutate(&id, |room| ops::set_paused(room, paused, now_millis()))?;
    Ok(room)
}

#[tauri::command]
pub fn room_cancel_reply(store: State<'_, Arc<RoomStore>>, id: String, message_id: String) -> Result<Room, AppError> {
    let (_, room) = store.mutate(&id, |room| ops::cancel_reply(room, &Actor::User, &message_id, now_millis()))?;
    Ok(room)
}

#[tauri::command]
pub fn room_task(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    op: RoomTaskOp,
) -> Result<Room, AppError> {
    let ((_, posted), room) = store.mutate(&id, |room| apply_task_op(room, &Actor::User, &op, now_millis()))?;
    deliver(&board, &registry, &room, &posted);
    Ok(room)
}
