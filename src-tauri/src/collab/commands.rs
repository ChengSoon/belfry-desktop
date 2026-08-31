use super::identity::SessionIdentities;
use super::registry::{SessionRegistry, SessionSnapshot};
use super::task::{self, TaskBoard};
use crate::terminal::AppError;
use tauri::State;

/// 待投递的协作任务。
///
/// 前端拉而不是 Rust 推：只有前端知道终端目标注册好了没——targets 表在它手上。
/// 每条只给投递需要的东西，调用链和 hop 这类闸门内部状态不外传。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingTask {
    pub id: String,
    /// 注入目标终端的完整文本，已经拼好三行协议头。
    pub text: String,
    pub to: String,
    pub from: String,
    pub from_label: String,
    pub instruction: String,
}

#[tauri::command]
pub fn collab_pending_tasks(
    board: State<'_, std::sync::Arc<TaskBoard>>,
    registry: State<'_, std::sync::Arc<SessionRegistry>>,
) -> Vec<PendingTask> {
    board
        .pending()
        .into_iter()
        .map(|entry| {
            // 派活方在目标眼里要是个能回话的名字：接收方读到「来自 planner」之后
            // 就能直接 `belfry send planner …` 回过去。退回 tabId 只是兜底。
            let from_label = registry
                .find(&entry.from)
                .and_then(|session| session.name)
                .unwrap_or_else(|| entry.from.clone());
            PendingTask {
                text: task::injection_text(&entry, &from_label),
                id: entry.id,
                to: entry.to,
                from: entry.from,
                from_label,
                instruction: entry.instruction,
            }
        })
        .collect()
}

/// 协作全貌，给面板用。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabView {
    pub tasks: Vec<TaskView>,
}

/// 一条任务在面板里的样子。
///
/// 两端都换成看得懂的标题：面板上一串 tabId 没法让人判断该不该批准。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub id: String,
    pub short_id: String,
    pub from_label: String,
    pub to_label: String,
    pub instruction: String,
    pub state: String,
    pub hop: u8,
    pub created_at: i64,
    pub result: Option<String>,
}

#[tauri::command]
pub fn collab_tasks(
    board: State<'_, std::sync::Arc<TaskBoard>>,
    registry: State<'_, std::sync::Arc<SessionRegistry>>,
) -> CollabView {
    // 面板上要显示用户自己起的名字：一串 tabId 没法让人判断该不该批准，
    // 而自动标题会随对话变，同一条任务隔一会儿再看就换了个称呼。
    let label = |tab_id: &str| {
        registry
            .find(tab_id)
            .and_then(|session| session.name)
            .unwrap_or_else(|| tab_id.to_string())
    };
    let mut tasks: Vec<TaskView> = board
        .snapshot()
        .into_iter()
        .map(|entry| TaskView {
            short_id: task::short_id(&entry.id).to_string(),
            from_label: label(&entry.from),
            to_label: label(&entry.to),
            id: entry.id,
            instruction: entry.instruction,
            state: format!("{:?}", entry.state).to_lowercase(),
            hop: entry.hop,
            created_at: entry.created_at,
            result: entry.result,
        })
        .collect();
    // 新的排前面：要处理的（等确认）通常就是刚发生的那条。
    tasks.sort_by_key(|task| std::cmp::Reverse(task.created_at));
    CollabView { tasks }
}

#[tauri::command]
pub fn collab_approve(
    board: State<'_, std::sync::Arc<TaskBoard>>,
    id: String,
) -> Result<(), AppError> {
    board
        .approve(&id)
        .map(|_| ())
        .map_err(AppError::invalid_argument)
}

#[tauri::command]
pub fn collab_reject(
    board: State<'_, std::sync::Arc<TaskBoard>>,
    id: String,
) -> Result<(), AppError> {
    board
        .reject(&id)
        .map(|_| ())
        .map_err(AppError::invalid_argument)
}

/// 一键全停。返回停掉几条，好在界面上给个确切的交代。
#[tauri::command]
pub fn collab_stop_all(board: State<'_, std::sync::Arc<TaskBoard>>) -> usize {
    board.stop_all()
}

/// 前端投递完回执。
#[tauri::command]
pub fn collab_mark_dispatched(board: State<'_, std::sync::Arc<TaskBoard>>, id: String) {
    board.mark_dispatched(&id);
}

/// 前端把会话名册同步过来。
///
/// 会话状态只在前端有，而控制 CLI 是从 PTY 里连进来问「现在有谁在」的，
/// 那时前端不在调用栈上——只能靠这份快照。
///
/// 顺带收回已经不在名册里的身份牌：会话关了 token 还有效的话，那条 PTY
/// 里残留的进程仍能以它的名义读写共享上下文。
#[tauri::command]
pub fn collab_sync_sessions(
    registry: State<'_, std::sync::Arc<SessionRegistry>>,
    identities: State<'_, std::sync::Arc<SessionIdentities>>,
    board: State<'_, std::sync::Arc<TaskBoard>>,
    sessions: Vec<SessionSnapshot>,
) {
    let live: Vec<String> = sessions.iter().map(|item| item.tab_id.clone()).collect();
    // 会话没了就把派给它、还没结的任务收掉：留着的话派活方会一直等一个
    // 永远不会来的 done。
    let gone: Vec<String> = board
        .snapshot()
        .into_iter()
        .map(|entry| entry.to)
        .filter(|to| !live.iter().any(|alive| alive == to))
        .collect();
    for tab_id in gone {
        board.abandon_for(&tab_id);
    }
    registry.replace(sessions);
    identities.retain(&live);
}
