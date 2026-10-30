//! 房间的命令面：列表 / 增删改、成员、讨论、派发、停止、验证、重新派发。
//!
//! 派发编排放在这里而不是 store：目标会话的判断要读名册、落任务要写
//! TaskBoard，两者都不属于「房间数据」本身。**先落库再投递**：保存失败就
//! 中止，不会出现「房间没记住、成员已经开工」的裂缝。

use std::sync::Arc;

use tauri::State;

use super::store::{
    new_id, now_millis, summarize, Delivery, DeliveryState, MessageKind, PendingReview, Room,
    RoomMessage, RoomStore, RoomTask, RoomsView, TaskArtifact, TaskStage,
    ARTIFACT_LIMIT,
};
use crate::collab::SessionRegistry;
use crate::collab::task::{
    self, ApprovalMode, TargetInfo, TaskBoard, TaskRequest, TaskOrigin, Verdict,
};
use crate::terminal::AppError;

/// 把一次用户派发翻译成每位成员一条总线任务。
///
/// 用户亲自派发即已表态（不再向用户要第二遍确认，ApprovalMode::Off），但闸门
/// 的边界一条不少：目标不存在 / 收不了指令 / 跨项目仍然硬拒。抽成不依赖
/// Tauri State 的函数，方便单测把每条拒绝路径钉死。
pub(crate) fn prepare_dispatches(
    room: &Room,
    registry: &SessionRegistry,
    text: &str,
    member_ids: &[String],
    now: i64,
) -> Result<Vec<(String, task::CollabTask)>, AppError> {
    let from = format!("room:{}", room.id);
    let mut seen = std::collections::HashSet::new();
    let mut prepared = Vec::with_capacity(member_ids.len());
    for member_id in member_ids {
        if !seen.insert(member_id.as_str()) {
            return Err(AppError::invalid_argument("同一个成员被选了两次"));
        }
        let member = room
            .active_member(member_id)
            .ok_or_else(|| AppError::invalid_argument("有接收者不在这个房间里"))?;
        let target = registry.find(&member.tab_id).ok_or_else(|| {
            AppError::invalid_argument(format!("成员「{}」的会话不在了，先给它换个会话再派", member.role))
        })?;
        let info = TargetInfo {
            exists: true,
            can_receive: target.can_receive,
            // 范围 = 建房间的项目 + 添加成员时扩展进来的根；闸门函数本身一字未改。
            same_project: target
                .project_root
                .as_deref()
                .is_some_and(|root| room.covers_project(root)),
        };
        let request = TaskRequest {
            from: &from,
            to: &member.tab_id,
            instruction: text,
            parent: None,
        };
        match task::judge(&request, &info, ApprovalMode::Off, 0) {
            Verdict::Rejected(reason) => {
                return Err(AppError::invalid_argument(format!(
                    "「{}」现在派不了：{reason}",
                    member.role
                )));
            }
            verdict => {
                let built = task::build_task(new_id(), &request, now, &verdict).with_origin(
                    TaskOrigin::Room {
                        id: room.id.clone(),
                        name: room.name.clone(),
                    },
                );
                prepared.push((member.id.clone(), built));
            }
        }
    }
    Ok(prepared)
}

#[tauri::command]
pub fn room_list(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
) -> Result<RoomsView, AppError> {
    store.reconcile_capturing(&board, now_millis(), &capture_artifact)?;
    store.list()
}

/// 待验证提醒的轮询入口：对账后返回全部处于「已提交待验证」的任务。
#[tauri::command]
pub fn room_pending_reviews(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
) -> Result<Vec<PendingReview>, AppError> {
    store.reconcile_capturing(&board, now_millis(), &capture_artifact)?;
    store.pending_reviews()
}

#[tauri::command]
pub fn room_get(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    id: String,
) -> Result<Room, AppError> {
    store.reconcile_capturing(&board, now_millis(), &capture_artifact)?;
    store.get(&id)
}

#[tauri::command]
pub fn room_create(
    store: State<'_, Arc<RoomStore>>,
    name: String,
    project_root: String,
) -> Result<Room, AppError> {
    let room = store.create(&name, &project_root)?;
    Ok(room)
}

#[tauri::command]
pub fn room_rename(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    name: String,
) -> Result<Room, AppError> {
    store.rename(&id, &name)
}

#[tauri::command]
pub fn room_delete(store: State<'_, Arc<RoomStore>>, board: State<'_, Arc<TaskBoard>>, id: String) -> Result<(), AppError> {
    // 删除前把还活着的投递停掉：房间没了，任务卡里也不该再有会动的条目。
    store.reconcile(&board, now_millis())?;
    if let Ok(room) = store.get(&id) {
        for task in &room.tasks {
            for delivery in &task.deliveries {
                if let Some(bus_id) = &delivery.bus_task_id {
                    let _ = board.stop(bus_id);
                }
            }
        }
    }
    store.delete(&id)
}

#[tauri::command]
pub fn room_add_member(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    tab_id: String,
    agent: String,
    role: String,
    duty: String,
    project_root: Option<String>,
) -> Result<Room, AppError> {
    let room = store.add_member(&id, &tab_id, &agent, &role, &duty)?;
    // 前端知道成员会话挂在哪；带过来就把房间的接活范围顺势扩到那边。
    // 只增不减，重复覆盖时是空操作。
    match project_root {
        Some(root) if !root.trim().is_empty() => store.extend_project(&id, &root),
        _ => Ok(room),
    }
}

#[tauri::command]
pub fn room_update_member(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    member_id: String,
    role: Option<String>,
    duty: Option<String>,
    tab_id: Option<String>,
) -> Result<Room, AppError> {
    store.update_member(&id, &member_id, role, duty, tab_id)
}

#[tauri::command]
pub fn room_remove_member(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    member_id: String,
) -> Result<Room, AppError> {
    store.remove_member(&id, &member_id)
}

#[tauri::command]
pub fn room_send_message(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    text: String,
    reply_to: Option<String>,
) -> Result<Room, AppError> {
    store.send_message(&id, &text, reply_to)
}

/// 用户给房间里某条消息点表情（再点一次取消）。成员侧同能力走 `belfry room react`。
#[tauri::command]
pub fn room_react(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    message_id: String,
    emoji: String,
) -> Result<Room, AppError> {
    store.user_react(&id, &message_id, &emoji)
}

/// 撤回自己刚发的一条群聊消息。
///
/// 时间线上标成已撤回；还没送出的投递当场从板上撤掉（成员不会收到）；已经进过
/// 成员终端的撤不回来——界面按送达回执如实标注。
#[tauri::command]
pub fn room_recall(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    id: String,
    message_id: String,
) -> Result<Room, AppError> {
    let (room, recalled) = store.recall_message(&id, &message_id)?;
    board.drop_pending_message(&recalled);
    Ok(room)
}

/// 清空房间的聊天记录。任务、决定与投递记录保留（右栏可查），成员终端不受影响。
#[tauri::command]
pub fn room_clear_messages(
    store: State<'_, Arc<RoomStore>>,
    id: String,
) -> Result<Room, AppError> {
    store.clear_messages(&id)
}

#[tauri::command]
pub fn room_mark_decision(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    message_id: String,
) -> Result<Room, AppError> {
    store.mark_decision(&id, &message_id)
}

#[tauri::command]
pub fn room_dispatch(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    text: String,
    member_ids: Vec<String>,
    acceptance: Option<Vec<String>>,
) -> Result<Room, AppError> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::invalid_argument("派活内容不能为空"));
    }
    if member_ids.is_empty() {
        return Err(AppError::invalid_argument("先选接收者，再发送"));
    }
    let now = now_millis();
    store.reconcile(&board, now)?;
    let room = store.get(&id)?;
    let prepared = prepare_dispatches(&room, &registry, &text, &member_ids, now)?;
    let acceptance: Vec<String> = acceptance
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    let task = RoomTask {
        id: new_id(),
        title: summarize(&text),
        text: text.clone(),
        member_ids: member_ids.clone(),
        acceptance,
        created_at: now,
        stage: TaskStage::Dispatching,
        attempt: 1,
        deliveries: prepared
            .iter()
            .map(|(member_id, built)| Delivery {
                member_id: member_id.clone(),
                bus_task_id: Some(built.id.clone()),
                state: DeliveryState::Queued,
                result: None,
                at: now,
            })
            .collect(),
        verified_at: None,
        verification_note: None,
        rejected_at: None,
        rejection_note: None,
        stopped_at: None,
        artifact: None,
    };
    let message = RoomMessage {
        id: new_id(),
        at: now,
        kind: MessageKind::User,
        author: "user".to_string(),
        text,
        member_ids: member_ids.clone(),
        task_id: Some(task.id.clone()),
        delivered_to: Vec::new(),
        reply_to: None,
        reactions: Vec::new(),
        recalled_at: None,
    };
    let room = store.record_dispatch(&id, task, message)?;
    for (_, built) in prepared {
        board.insert(built);
    }
    Ok(room)
}

/// 用户在房间里不选接收者直接发送的落点：**群聊通道**。
///
/// 不建交差任务、不要求 `belfry done`——只把对话送进在场成员的终端，
/// 时间线上就是一条普通消息。忙碌的成员排队等它空闲（聊天不该因为对方正忙被拒）；
/// 会话已不在的成员跳过；20 秒内的连发并进同一条注入，免得反复打断。
/// 用户写的 `@角色` 与成员发言同义：@ 了谁就只发给谁（请对方接话），不 @ 发给全体。
#[tauri::command]
pub fn room_broadcast(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    text: String,
    reply_to: Option<String>,
) -> Result<Room, AppError> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::invalid_argument("说点什么再发"));
    }
    let now = now_millis();
    store.reconcile(&board, now)?;
    let room = store.get(&id)?;
    let origin = TaskOrigin::Room {
        id: room.id.clone(),
        name: room.name.clone(),
    };
    let room_id = room.id.clone();
    let line = format!("用户：{text}");
    let from = format!("room:{room_id}");
    // 用户写的 @角色 与成员发言同义：@ 了谁就只发给谁；不 @ 才发给全体。
    let mentioned: Vec<String> = super::store::mentions_in(&room, &text)
        .iter()
        .map(|target| target.member_id.clone())
        .collect();
    let mut audience: Vec<(String, String)> = Vec::new();
    for target in super::store::chat_targets(&room, &mentioned, None) {
        if registry.find(&target.tab_id).is_none() {
            continue;
        }
        audience.push((target.member_id, target.tab_id));
    }
    // 消息 id 先生成：投递送达后按它把回执写回这条消息。
    let message_id = new_id();
    // 先落库再投递：保存失败就中止，不会出现「房间没记住、成员已经开工」的裂缝。
    let updated = store.record_chat(
        &room_id,
        &message_id,
        &text,
        audience.iter().map(|(member_id, _)| member_id.clone()).collect(),
        reply_to,
    )?;
    for (member_id, tab_id) in &audience {
        let direct = mentioned.contains(member_id);
        if !board.append_pending_chat(tab_id, &room_id, &line, &message_id, now, direct) {
            board.insert(
                task::chat_task(new_id(), &message_id, &from, tab_id, &line, direct, now)
                    .with_origin(origin.clone()),
            );
        }
    }
    Ok(updated)
}

#[tauri::command]
pub fn room_stop_task(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    id: String,
    task_id: String,
) -> Result<Room, AppError> {
    let now = now_millis();
    store.reconcile(&board, now)?;
    // 先把房间侧的停止落下来（界面的真相来源），再尽力去停总线任务；
    // 已经交到终端的那一步拦不回来，两侧都会如实显示这一点。
    let room = store.stop_task(&id, &task_id, now)?;
    if let Some(task) = room.tasks.iter().find(|task| task.id == task_id) {
        for delivery in &task.deliveries {
            if let Some(bus_id) = &delivery.bus_task_id {
                let _ = board.stop(bus_id);
            }
        }
    }
    Ok(room)
}

#[tauri::command]
pub fn room_verify_task(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    task_id: String,
    note: Option<String>,
) -> Result<Room, AppError> {
    store.verify_task(&id, &task_id, note, now_millis())
}

/// 验证不通过：旧任务记为已退回，并立即开一条带反馈的跟进派活。
///
/// 顺序与派发一致：先过闸门、再落库、最后投递。闸门不过就整体失败，
/// 旧任务保持「已提交待验证」不动——不能出现「退回了、但没人干活」。
#[tauri::command]
pub fn room_reject_task(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    task_id: String,
    feedback: String,
) -> Result<Room, AppError> {
    let feedback = feedback.trim().to_string();
    if feedback.is_empty() {
        return Err(AppError::invalid_argument("退回时要写清哪里没通过"));
    }
    let now = now_millis();
    store.reconcile(&board, now)?;
    let room = store.get(&id)?;
    let task = room
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .ok_or_else(|| AppError::not_found("找不到这条任务"))?;
    if task.stage != TaskStage::Submitted {
        return Err(AppError::invalid_argument("只有「已提交待验证」的任务可以退回重做"));
    }
    // 只派给还在房间里的成员：有人中途离开时跟进任务照常发出，
    // 少掉的那位在旧任务的投递记录里仍看得见。
    let member_ids: Vec<String> = task
        .deliveries
        .iter()
        .map(|delivery| delivery.member_id.clone())
        .filter(|member_id| room.active_member(member_id).is_some())
        .collect();
    if member_ids.is_empty() {
        return Err(AppError::invalid_argument("原来的成员都离开房间了，改成手动派发吧"));
    }
    // 反馈拼进新任务正文：成员看到的是一份完整上下文，不用自己回翻历史。
    let text = format!("{}\n\n上一轮验证未通过，退回重做。要求：{feedback}", task.text);
    let prepared = prepare_dispatches(&room, &registry, &text, &member_ids, now)?;
    let follow_up = RoomTask {
        id: new_id(),
        title: format!("（退回）{}", task.title),
        text: text.clone(),
        member_ids: member_ids.clone(),
        acceptance: task.acceptance.clone(),
        created_at: now,
        stage: TaskStage::Dispatching,
        attempt: 1,
        deliveries: prepared
            .iter()
            .map(|(member_id, built)| Delivery {
                member_id: member_id.clone(),
                bus_task_id: Some(built.id.clone()),
                state: DeliveryState::Queued,
                result: None,
                at: now,
            })
            .collect(),
        verified_at: None,
        verification_note: None,
        rejected_at: None,
        rejection_note: None,
        stopped_at: None,
        artifact: None,
    };
    let message = RoomMessage {
        id: new_id(),
        at: now,
        kind: MessageKind::User,
        author: "user".to_string(),
        text: text.clone(),
        member_ids: member_ids.clone(),
        task_id: Some(follow_up.id.clone()),
        delivered_to: Vec::new(),
        reply_to: None,
        reactions: Vec::new(),
        recalled_at: None,
    };
    let room = store.reject_task(&id, &task_id, &feedback, now, follow_up, message)?;
    for (_, built) in prepared {
        board.insert(built);
    }
    Ok(room)
}

#[tauri::command]
pub fn room_retry_task(
    store: State<'_, Arc<RoomStore>>,
    board: State<'_, Arc<TaskBoard>>,
    registry: State<'_, Arc<SessionRegistry>>,
    id: String,
    task_id: String,
    member_ids: Option<Vec<String>>,
) -> Result<Room, AppError> {
    let now = now_millis();
    store.reconcile(&board, now)?;
    let room = store.get(&id)?;
    let task = room
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .ok_or_else(|| AppError::not_found("找不到这条任务"))?;
    // 整体重派仍只认「结果未知」；单成员补投的合法性交给 store 按投递状态逐条判定。
    let targets: Vec<String> = match &member_ids {
        None => {
            if task.stage != TaskStage::Interrupted {
                return Err(AppError::invalid_argument("只有「结果未知」的任务可以重新派发"));
            }
            task.deliveries
                .iter()
                .map(|delivery| delivery.member_id.clone())
                .collect()
        }
        Some(list) => {
            if list.is_empty() {
                return Err(AppError::invalid_argument("先选要重派的成员"));
            }
            list.clone()
        }
    };
    let prepared = prepare_dispatches(&room, &registry, &task.text, &targets, now)?;
    let replacement: Vec<(String, String)> = prepared
        .iter()
        .map(|(member_id, built)| (member_id.clone(), built.id.clone()))
        .collect();
    let room = store.retry_task(&id, &task_id, member_ids, now, replacement)?;
    for (_, built) in prepared {
        board.insert(built);
    }
    Ok(room)
}

/// 采集失败（不在 Git 仓库、git 报错）的项目根，进程内记着不再重试。
///
/// 快照是证据增强，不值得让每一拍轮询都去起一个注定失败的 git 子进程；
/// 目录后来才变成仓库的话，重启应用即可恢复采集。
fn capture_failed_roots() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static FAILED: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    FAILED.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

/// 给 `reconcile_capturing` 用的采集器：读房间项目根的工作区差异。
///
/// `Ok` 一律给快照（空差异也算——「交差时工作区没有改动」本身就是一句证据，
/// 而且写了才能让幂等检查停下来）；只有读不出来才返回 None。
fn capture_artifact(project_root: &str) -> Option<TaskArtifact> {
    let failed = capture_failed_roots()
        .lock()
        .map(|roots| roots.contains(project_root))
        .unwrap_or(true);
    if failed {
        return None;
    }
    match crate::git::workspace_diff(project_root, ARTIFACT_LIMIT) {
        Ok(diff) => Some(TaskArtifact {
            captured_at: now_millis(),
            truncated: diff.truncated,
            text: diff.text,
        }),
        Err(_) => {
            if let Ok(mut roots) = capture_failed_roots().lock() {
                roots.insert(project_root.to_string());
            }
            None
        }
    }
}

/// 在独立窗口里打开一间房。已经开着就聚焦——同一间房开两个视图只会多一份
/// 需要对齐的现场，没有任何好处。
#[tauri::command]
pub fn room_open_window(
    app: tauri::AppHandle,
    room_id: String,
    room_name: String,
) -> Result<(), AppError> {
    use tauri::Manager;
    let label = room_window_label(&room_id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(format!("index.html?room={room_id}").into()),
    )
    .title(format!("协作房间 · {room_name}"))
    .inner_size(1100.0, 780.0)
    .min_inner_size(760.0, 540.0)
    .build()
    .map_err(|err| AppError::io(format!("打不开房间窗口：{err}")))?;
    Ok(())
}

/// 窗口标签：加前缀，和主窗口及别处的窗口区分开。ULID 只有字母数字，不用转义。
fn room_window_label(room_id: &str) -> String {
    format!("room-{room_id}")
}

#[cfg(test)]
mod window_tests {
    use super::room_window_label;

    #[test]
    fn room_window_labels_are_namespaced() {
        assert_eq!(room_window_label("01j8abc"), "room-01j8abc");
        assert!(room_window_label("x").starts_with("room-"));
    }
}
