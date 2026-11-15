//! 界面的 Tauri 命令。用户在界面上的动作和成员在 CLI 里的动作走同一套 `ops`，
//! 区别只在身份：界面上永远是 `Actor::User`（有协调权）。
//!
//! 每个改动都返回改完的整间房：状态真相在 Rust，前端不做乐观更新。

use std::sync::Arc;

use belfry_protocol::RoomTaskOp;
use tauri::{AppHandle, Manager, State};

use super::attachments;
use super::model::*;
use super::ops::{self, Posted};
use super::store::{RoomStore, RoomsView, deliveries};
use crate::collab::task::{self, TaskBoard};
use crate::collab::{SessionIdentities, SessionRegistry};
use crate::terminal::{AppError, TerminalRuntime};

/// 把动作产出的消息排进成员终端。会话已经不在的跳过：消息照样留在时间线上。
fn deliver(
    store: &RoomStore,
    board: &TaskBoard,
    registry: &SessionRegistry,
    room: &Room,
    posted: &[Posted],
) {
    enqueue(store, board, registry, deliveries(room, posted));
}

fn enqueue(
    store: &RoomStore,
    board: &TaskBoard,
    registry: &SessionRegistry,
    posts: Vec<crate::collab::RoomPost>,
) {
    if let Err(error) = store.enqueue_posts(board, registry, &posts) {
        log::warn!("Room post retained in durable outbox: {}", error.message);
    }
}

/// 任务板操作：界面与 CLI 共用这一张分派表。返回动到的任务号与要投递的消息。
pub(super) fn apply_task_op(
    room: &mut Room,
    actor: &Actor,
    op: &RoomTaskOp,
    now: i64,
) -> Result<(String, Vec<Posted>), String> {
    let same = |task: &String, result: Result<Vec<Posted>, String>| {
        result.map(|posted| (task.clone(), posted))
    };
    match op {
        RoomTaskOp::Add {
            title,
            outcome,
            assignee,
            after,
        } => ops::task_add(
            room,
            actor,
            title,
            outcome.as_deref(),
            assignee.as_deref(),
            after,
            now,
        ),
        RoomTaskOp::Assign { task, assignee } => {
            same(task, ops::task_assign(room, actor, task, assignee, now))
        }
        RoomTaskOp::Start { task } => same(task, ops::task_start(room, actor, task, now)),
        RoomTaskOp::Done {
            task,
            result,
            generation,
        } => {
            if let Some(generation) = generation
                && room
                    .task_index(task)
                    .is_none_or(|index| room.tasks[index].generation != *generation)
            {
                return Err("Task assignment generation changed; this completion belongs to an earlier lifecycle".into());
            }
            same(
                task,
                ops::task_done(room, actor, task, result.as_deref(), now),
            )
        }
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
    let idle = |tab_id: &str| {
        registry
            .find(tab_id)
            .is_some_and(|session| matches!(session.activity.as_str(), "idle" | "done"))
    };
    let posts = store.nudge_idle(&idle, now_millis())?;
    enqueue(&store, &board, &registry, posts);
    store.list()
}

#[tauri::command]
pub fn room_get(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    id: String,
) -> Result<Room, AppError> {
    store.reconcile(&board)?;
    store.get(&id)
}

#[tauri::command]
pub fn room_history(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    cursor: Option<String>,
    limit: Option<usize>,
) -> Result<super::history::HistoryPage, AppError> {
    store.history(&id, cursor.as_deref(), limit)
}

#[tauri::command]
pub fn room_create(
    store: State<'_, Arc<RoomStore>>,
    name: String,
    project_root: String,
    objective: Option<String>,
) -> Result<Room, AppError> {
    store.create(
        &name,
        &project_root,
        objective.as_deref().unwrap_or_default(),
    )
}

#[tauri::command]
pub fn room_rename(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    name: String,
) -> Result<Room, AppError> {
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
pub async fn room_delete(app: AppHandle, id: String) -> Result<Vec<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_with_sessions(
            &app.state::<Arc<RoomStore>>(),
            &app.state::<Arc<TaskBoard>>(),
            &app.state::<Arc<SessionRegistry>>(),
            &app.state::<Arc<SessionIdentities>>(),
            &app.state::<TerminalRuntime>(),
            &id,
            |terminal_id| crate::plugins::agent_connection::release(&app, terminal_id),
        )
    })
    .await
    .map_err(|error| AppError::io(error.to_string()))?
}

/// Persist deletion before touching terminals; a rejected disk commit has no session side effects.
/// Terminal I/O runs outside the room lock and uses the ordinary close-by-tab path.
pub(crate) fn delete_with_sessions(
    store: &RoomStore,
    board: &TaskBoard,
    registry: &SessionRegistry,
    identities: &SessionIdentities,
    runtime: &TerminalRuntime,
    id: &str,
    release: impl Fn(&str),
) -> Result<Vec<String>, AppError> {
    let tabs = store.delete(id)?;
    let deleted = tabs.iter().cloned().collect();
    for tab in &tabs {
        runtime.cancel_pending(tab);
        identities.revoke(tab);
    }
    registry.remove_tabs(&deleted);
    let mut failure = None;
    // 房间没了，还排着队的消息也不该再送出去。
    for queued in board.snapshot() {
        if matches!(&queued.origin, Some(task::TaskOrigin::Room { id: room_id, .. }) if room_id == id)
        {
            if let Err(error) = board.remove(&queued.id) {
                failure.get_or_insert_with(|| AppError::io(error));
            }
        }
    }
    for tab in &tabs {
        if let Err(error) = board.abandon_for(tab) {
            failure.get_or_insert_with(|| AppError::io(error));
        }
        match runtime.close_tab(tab) {
            Ok(ids) => ids.iter().for_each(|terminal_id| release(terminal_id)),
            Err(error) => {
                failure.get_or_insert(error);
            }
        }
    }
    match failure {
        Some(error) => Err(error),
        None => Ok(tabs),
    }
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
    store.ensure_tab_available(&tab_id)?;
    let ((_, posted), room) = store.mutate(&id, |room| {
        ops::add_member(
            room,
            &tab_id,
            &agent,
            &title,
            &duty,
            foreman.unwrap_or(false),
            now_millis(),
        )
    })?;
    deliver(&store, &board, &registry, &room, &posted);
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
    if let Some(tab) = &tab_id {
        store.ensure_tab_available(tab)?;
    }
    let (posted, room) = store.mutate(&id, |room| {
        ops::update_member(
            room,
            &member_id,
            title.as_deref(),
            duty.as_deref(),
            tab_id.as_deref(),
            now_millis(),
        )
    })?;
    deliver(&store, &board, &registry, &room, &posted);
    Ok(room)
}

#[tauri::command]
pub fn room_set_member_model(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    member_id: String,
    expected_tab_id: String,
    expected_agent: String,
    expected_model_override: Option<String>,
    model_override: Option<String>,
) -> Result<Room, AppError> {
    store.set_member_model(
        &id,
        &member_id,
        &expected_tab_id,
        &expected_agent,
        expected_model_override.as_deref(),
        model_override.as_deref(),
    )
}

#[tauri::command]
pub fn room_set_foreman(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    member_id: String,
) -> Result<Room, AppError> {
    let (posted, room) =
        store.mutate(&id, |room| ops::set_foreman(room, &member_id, now_millis()))?;
    deliver(&store, &board, &registry, &room, &posted);
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
    let (posted, room) = store.mutate(&id, |room| {
        ops::remove_member(room, &member_id, now_millis())
    })?;
    deliver(&store, &board, &registry, &room, &posted);
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
        ops::update_brief(
            room,
            &Actor::User,
            objective.as_deref(),
            focus.as_deref(),
            constraints,
            now_millis(),
        )
    })?;
    deliver(
        &store,
        &board,
        &registry,
        &room,
        std::slice::from_ref(&posted),
    );
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
        ops::say_with(
            room,
            &Actor::User,
            &to.unwrap_or_default(),
            &text,
            reply_to.as_deref(),
            ask.unwrap_or(false),
            files,
            now_millis(),
        )
    })?;
    deliver(
        &store,
        &board,
        &registry,
        &room,
        std::slice::from_ref(&posted),
    );
    Ok(room)
}

#[tauri::command]
pub fn room_set_paused(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    paused: bool,
) -> Result<Room, AppError> {
    let (_, room) = store.mutate(&id, |room| ops::set_paused(room, paused, now_millis()))?;
    Ok(room)
}

#[tauri::command]
pub fn room_cancel_reply(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    message_id: String,
) -> Result<Room, AppError> {
    let (_, room) = store.mutate(&id, |room| {
        ops::cancel_reply(room, &Actor::User, &message_id, now_millis())
    })?;
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
    let ((_, posted), room) = store.mutate(&id, |room| {
        apply_task_op(room, &Actor::User, &op, now_millis())
    })?;
    deliver(&store, &board, &registry, &room, &posted);
    Ok(room)
}
