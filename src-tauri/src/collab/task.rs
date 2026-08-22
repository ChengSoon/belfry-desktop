//! 派活：一条会话让另一条会话去做点什么。
//!
//! 这个模块只管**任务本身**和**准不准派**，不碰传输也不碰投递。放在纯逻辑层
//! 是因为闸门是整个功能里最不能出错的部分：项目已经在用
//! `--dangerously-skip-permissions` 启动 Claude，能互相派活 + 跳过确认，
//! 一次误判就会变成一串会话连锁执行。这种东西必须能单测到每一条边界。

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// 一手能转几道。A→B→C→D 就停。
///
/// 不设上限的话，一个「你去找人帮忙」的指令可以无限转包下去；
/// 设成 3 是因为再深的链路人已经看不懂谁在替谁干活了。
pub const MAX_HOPS: u8 = 3;

/// 一轮协作里最多来回几条。
///
/// 环检测挡得住 A→B→A，挡不住 A→B、A→C、A→D…… 这种扇出。
pub const MAX_MESSAGES_PER_RUN: usize = 20;

/// 派活的准入判断结果。拒绝时带一句给 Agent 看的人话。
#[derive(Clone, Debug, PartialEq)]
pub enum Verdict {
    /// 可以派，但要先问过用户。
    NeedsApproval,
    /// 可以直接派。
    Allowed,
    Rejected(String),
}

/// 什么时候需要用户点头。
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalMode {
    /// 每条跨会话指令都问。默认——项目的取向是不静默做危险的事。
    #[default]
    Ask,
    /// 同项目内自动放行，跨项目仍然拒绝。
    AutoInProject,
    /// 全部放行。用户自己选的。
    Off,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskState {
    /// 已入队，等目标空闲。
    Queued,
    /// 已注入目标终端，等它干活。
    Dispatched,
    /// 目标敲了 `belfry done`——唯一可信的完成信号。
    Done,
    Failed,
    /// 目标会话没了 / 用户中止 / 超时。
    Abandoned,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabTask {
    pub id: String,
    pub from: String,
    pub to: String,
    pub instruction: String,
    pub state: TaskState,
    pub hop: u8,
    /// 完整调用链，含 from 和 to。环检测靠它。
    pub path: Vec<String>,
    pub created_at: i64,
    /// 目标声明的结果：产物路径或一句话。只有它自己能填。
    pub result: Option<String>,
}

/// 派活请求在通过闸门之前的样子。
pub struct TaskRequest<'a> {
    pub from: &'a str,
    pub to: &'a str,
    pub instruction: &'a str,
    /// 派活者自己是被谁派来的（如果有）。决定这一手是第几道。
    pub parent: Option<&'a CollabTask>,
}

/// 目标会话在闸门眼里的样子。只要这几项，不关心它是哪个 agent。
pub struct TargetInfo {
    pub exists: bool,
    pub can_receive: bool,
    pub same_project: bool,
}

/// 准不准派。
///
/// 顺序有讲究：先拦「根本不可能成功」的（目标不存在、派给自己），
/// 再拦「会失控」的（跳数、环、预算），最后才问权限。反过来的话，
/// 用户会为一条注定失败的指令被弹窗打断。
pub fn judge(
    request: &TaskRequest<'_>,
    target: &TargetInfo,
    mode: ApprovalMode,
    messages_this_run: usize,
) -> Verdict {
    if request.instruction.trim().is_empty() {
        return Verdict::Rejected("指令是空的".into());
    }
    if request.from == request.to {
        // 自己派给自己会变成一个自己等自己的死结。
        return Verdict::Rejected("不能给自己派活".into());
    }
    if !target.exists {
        return Verdict::Rejected("目标会话不在了".into());
    }
    if !target.can_receive {
        return Verdict::Rejected("目标会话现在收不了指令（不是 Agent，或已退出）".into());
    }
    if !target.same_project {
        // 跨项目一律拒，连 Off 模式也不放行：这不是「危险但用户认了」，
        // 而是共享上下文和工作目录都对不上，派过去也做不对。
        return Verdict::Rejected("不能跨项目派活".into());
    }

    let hop = next_hop(request.parent);
    if hop > MAX_HOPS {
        return Verdict::Rejected(format!("转包层数超过上限（{MAX_HOPS} 手）"));
    }
    if let Some(parent) = request.parent
        && parent.path.iter().any(|node| node == request.to)
    {
        // A→B→A 这种环会让两条会话互相等待，谁也不会先动。
        return Verdict::Rejected("这条调用链里已经有目标会话了，会绕成环".into());
    }
    if messages_this_run >= MAX_MESSAGES_PER_RUN {
        return Verdict::Rejected(format!(
            "这一轮的消息数已达上限（{MAX_MESSAGES_PER_RUN} 条）"
        ));
    }

    match mode {
        ApprovalMode::Ask => Verdict::NeedsApproval,
        ApprovalMode::AutoInProject | ApprovalMode::Off => Verdict::Allowed,
    }
}

fn next_hop(parent: Option<&CollabTask>) -> u8 {
    parent.map_or(1, |task| task.hop.saturating_add(1))
}

/// 造一条通过闸门后的任务。
pub fn build_task(
    id: String,
    request: &TaskRequest<'_>,
    now: i64,
) -> CollabTask {
    let hop = next_hop(request.parent);
    let mut path = request
        .parent
        .map(|task| task.path.clone())
        .unwrap_or_else(|| vec![request.from.to_string()]);
    path.push(request.to.to_string());
    CollabTask {
        id,
        from: request.from.to_string(),
        to: request.to.to_string(),
        instruction: request.instruction.trim().to_string(),
        state: TaskState::Queued,
        hop,
        path,
        created_at: now,
        result: None,
    }
}

/// 注入目标终端的文本。
///
/// 三行封顶。每个字都占目标 Agent 的上下文，还会污染它自己的对话——
/// 「入职说明」「工具清单」那类一次性铺垫属于它的 system prompt，不是我们该塞的。
pub fn injection_text(task: &CollabTask, from_label: &str) -> String {
    format!(
        "[belfry] 来自「{from_label}」的任务 {}\n{}\n完成后执行：belfry done --task {}",
        short_id(&task.id),
        task.instruction,
        short_id(&task.id),
    )
}

/// 短 id 够人和 Agent 认，全长 ULID 在提示行里太占地方。
pub fn short_id(id: &str) -> &str {
    let end = id.char_indices().nth(8).map_or(id.len(), |(at, _)| at);
    &id[..end]
}

/// 在跑的任务。
///
/// 只活在内存：会话进程跨不过应用重启，存下来的任务只是一份没人认领的空壳。
/// 这条和 Recipe 的 RecipeRun 是同一个判断。
#[derive(Default)]
pub struct TaskBoard {
    tasks: Mutex<HashMap<String, CollabTask>>,
}

impl TaskBoard {
    pub fn insert(&self, task: CollabTask) {
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.insert(task.id.clone(), task);
        }
    }

    /// 取一条。目前只有测试在用——生产路径要么整份 snapshot，要么按状态过滤。
    #[cfg(test)]
    pub fn get(&self, id: &str) -> Option<CollabTask> {
        self.tasks.lock().ok()?.get(id).cloned()
    }

    /// 目标声明干完了。
    ///
    /// 只有任务的**接收方**能改自己的状态：派活方说「你干完了」没有意义，
    /// 而让任意会话都能标记完成，等于把这个信号的可信度降为零。
    pub fn settle(
        &self,
        id: &str,
        claimant: &str,
        state: TaskState,
        result: Option<String>,
    ) -> Result<CollabTask, String> {
        let Ok(mut tasks) = self.tasks.lock() else {
            return Err("任务表锁不上".into());
        };
        let Some(task) = tasks.get_mut(id) else {
            return Err(format!("没有编号 {id} 的任务"));
        };
        if task.to != claimant {
            return Err("这条任务不是派给你的".into());
        }
        if matches!(task.state, TaskState::Done | TaskState::Failed) {
            return Err("这条任务已经结了".into());
        }
        task.state = state;
        task.result = result;
        Ok(task.clone())
    }

    /// 还没投递给目标终端的任务。
    ///
    /// 前端定期来取，投进 Prompt 队列后回头调 `mark_dispatched`。用拉而不是推，
    /// 是因为只有前端知道终端目标注册好了没——它手上有 targets 表。
    pub fn pending(&self) -> Vec<CollabTask> {
        self.tasks
            .lock()
            .map(|tasks| {
                let mut queued: Vec<CollabTask> = tasks
                    .values()
                    .filter(|task| task.state == TaskState::Queued)
                    .cloned()
                    .collect();
                // 按创建时间投递：同一目标收到多条时，顺序应该和派活顺序一致。
                queued.sort_by_key(|task| task.created_at);
                queued
            })
            .unwrap_or_default()
    }

    /// 标记已交给终端。
    ///
    /// 只从 Queued 迁移：已经结掉的任务不该被一次迟到的投递回执改回进行中。
    pub fn mark_dispatched(&self, id: &str) {
        if let Ok(mut tasks) = self.tasks.lock()
            && let Some(task) = tasks.get_mut(id)
            && task.state == TaskState::Queued
        {
            task.state = TaskState::Dispatched;
        }
    }

    /// 某条会话作为接收方还没结的任务。用来在会话关闭时收尾。
    pub fn abandon_for(&self, tab_id: &str) {
        if let Ok(mut tasks) = self.tasks.lock() {
            for task in tasks.values_mut() {
                if task.to == tab_id && matches!(task.state, TaskState::Queued | TaskState::Dispatched)
                {
                    task.state = TaskState::Abandoned;
                }
            }
        }
    }

    /// 这一轮已经发生过多少条。预算闸门读它。
    pub fn count_in_path(&self, root: &str) -> usize {
        self.tasks
            .lock()
            .map(|tasks| {
                tasks
                    .values()
                    .filter(|task| task.path.first().is_some_and(|first| first == root))
                    .count()
            })
            .unwrap_or(0)
    }

    pub fn snapshot(&self) -> Vec<CollabTask> {
        self.tasks
            .lock()
            .map(|tasks| tasks.values().cloned().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
#[path = "task_test.rs"]
mod tests;
