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

/// 群聊合并窗口：同一位接收者排队中的群聊投递，这段时间内的新消息并进同一条
/// 注入——成员读到一段对话摘录，而不是被反复打断。
pub const CHAT_MERGE_WINDOW_MS: i64 = 20_000;

/// 群聊防抖：连发期间投递一直往后顺延，等这一小段安静下来再整段送出——
/// 否则合并窗口只有「下一拍轮询前」那么短，摘录根本攒不起来。
pub const CHAT_DEBOUNCE_MS: i64 = 2_500;

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
    /// 等用户点头。没批准之前绝不投递——否则 Ask 模式形同虚设。
    PendingApproval,
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

/// 派活来源：普通会话之间的互派，或一个协作房间。
///
/// 只在 app 内部流转，不进 CLI 协议：房间派发的任务在协作面板和注入文本里
/// 都要显示成「来自房间名」，而不是一串 `room:<id>` 的伪 tabId。
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum TaskOrigin {
    Room { id: String, name: String },
}

/// 房间群聊投递的语境。带它的任务只负责把对话送进目标终端：
/// 不进任务状态机（没人需要 `belfry done`），也不进协作面板与 inbox——
/// 交差、回执、验证都属于「派活」，不属于聊天。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDelivery {
    /// 点名：这轮请对方接话（不点名的群聊＝看见即可）。
    pub mentioned: bool,
    /// 这条投递承载的消息 id（连发合并会带多条）：送达后按它把回执写回时间线。
    pub message_ids: Vec<String>,
    /// 与 `message_ids` 一一对应的正文行（同步成对推入，下标对齐）。存下来是为了
    /// 撤回：消息撤了就从投递里摘掉对应那行，不用去猜 `instruction` 的行号。
    #[serde(default)]
    pub lines: Vec<String>,
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
    /// 派活来源。会话互派为 None；房间派发带房间标记（见 `TaskOrigin`）。
    #[serde(default)]
    pub origin: Option<TaskOrigin>,
    /// 房间群聊投递的语境；`None`＝普通任务（要交差的那一类）。
    #[serde(default)]
    pub chat: Option<ChatDelivery>,
    /// 早于它不进投递（毫秒）。普通任务为 0；群聊投递带一小段防抖，
    /// 让连发并成一段再送出。
    #[serde(default)]
    pub due_at: i64,
}

impl CollabTask {
    /// 标记为房间派发。构建后链式调用；会话互派不需要调用。
    pub fn with_origin(mut self, origin: TaskOrigin) -> Self {
        self.origin = Some(origin);
        self
    }
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
///
/// `verdict` 决定它是直接排队还是先等用户点头——这一步不能省，
/// 否则 `NeedsApproval` 的任务照样会被投递，Ask 模式就形同虚设。
pub fn build_task(
    id: String,
    request: &TaskRequest<'_>,
    now: i64,
    verdict: &Verdict,
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
        state: match verdict {
            Verdict::NeedsApproval => TaskState::PendingApproval,
            _ => TaskState::Queued,
        },
        hop,
        path,
        created_at: now,
        result: None,
        origin: None,
        chat: None,
        due_at: 0,
    }
}

/// 造一条房间群聊投递：不经过 `judge`（房间成员资格就是用户的授权），
/// 也不进任务状态机——它只是一条要送进对方终端的对话。
pub fn chat_task(
    id: String,
    message_id: &str,
    from: &str,
    to: &str,
    line: &str,
    mentioned: bool,
    now: i64,
) -> CollabTask {
    CollabTask {
        id,
        from: from.to_string(),
        to: to.to_string(),
        instruction: line.trim().to_string(),
        state: TaskState::Queued,
        hop: 1,
        path: vec![from.to_string(), to.to_string()],
        created_at: now,
        result: None,
        origin: None,
        chat: Some(ChatDelivery {
            mentioned,
            message_ids: vec![message_id.to_string()],
            lines: vec![line.trim().to_string()],
        }),
        due_at: now + CHAT_DEBOUNCE_MS,
    }
}

/// 注入目标终端的文本。
///
/// 三行封顶。每个字都占目标 Agent 的上下文，还会污染它自己的对话——
/// 「入职说明」「工具清单」那类一次性铺垫属于它的 system prompt，不是我们该塞的。
pub fn injection_text(task: &CollabTask, from_label: &str) -> String {
    // 群聊口吻：告诉它这是聊天、不是派活——看见即可，要接话就走 room say。
    // 没有任务号、没有 done 行：成员不该把闲聊当工单去交差。
    if let Some(chat) = &task.chat {
        return if chat.mentioned {
            format!(
                "[belfry] 房间「{from_label}」的群聊里点了你的名：\n{}\n请回一句：belfry room say <你的要点>（大家都会看到）",
                task.instruction
            )
        } else {
            format!(
                "[belfry] 房间「{from_label}」的群聊：\n{}\n看见即可；要接话用 belfry room say <你的话>，没有补充就不必回复。",
                task.instruction
            )
        };
    }
    // 这行命令必须和 CLI 的实参语法逐字对上：`done` 收的是位置参数。写成
    // `--task <id>` 的话，Agent 照着敲会把 `--task` 当成任务号——真任务永远结不掉，
    // 而它自己以为已经交差了。e2e 测试会把这行原样跑一遍来钉住。
    format!(
        "[belfry] 来自「{from_label}」的任务 {}\n{}\n完成后执行：belfry done {}",
        short_id(&task.id),
        task.instruction,
        short_id(&task.id),
    )
}

/// 这条任务到终点了没。
///
/// `wait` 靠它决定还要不要接着等，所以判断必须留在这里：让 CLI 自己维护一份
/// 「哪些算结束」的清单，那份清单迟早和这个状态机漂开，而漂开的表现是
/// `wait` 永远不返回。
pub fn is_settled(state: &TaskState) -> bool {
    matches!(
        state,
        TaskState::Done | TaskState::Failed | TaskState::Abandoned
    )
}

/// 短 id 够人和 Agent 认，全长 ULID 在提示行里太占地方。
pub fn short_id(id: &str) -> &str {
    // 取尾部而不是头部：ULID 的前 10 个字符是毫秒时间戳，同一毫秒里派出的两条任务
    // 前缀一模一样。按前缀查会命中另一条——表现是接收方明明敲了 done，却被告知
    // 「这条任务不是派给你的」，或者更糟：悄悄把别人的任务结掉了。尾部是随机位。
    let start = id.char_indices().rev().nth(7).map_or(0, |(at, _)| at);
    &id[start..]
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

    /// 把一行新消息并进这位接收者还排队中的群聊投递（同房间、窗口内）。
    ///
    /// 并入成功返回 true；已送达、超出窗口或根本没有可并的，返回 false，由调用方
    /// 新建一条。点名只升级不降级：广播并进点名投递后，整块仍按「请你说」送达。
    pub fn append_pending_chat(
        &self,
        to: &str,
        room_id: &str,
        line: &str,
        message_id: &str,
        now: i64,
        mentioned: bool,
    ) -> bool {
        let Ok(mut tasks) = self.tasks.lock() else {
            return false;
        };
        let candidate = tasks
            .values_mut()
            .filter(|task| {
                task.chat.is_some()
                    && task.state == TaskState::Queued
                    && task.to == to
                    && now - task.created_at <= CHAT_MERGE_WINDOW_MS
                    && matches!(&task.origin, Some(TaskOrigin::Room { id, .. }) if id == room_id)
            })
            .max_by_key(|task| task.created_at);
        let Some(task) = candidate else {
            return false;
        };
        if mentioned
            && let Some(chat) = task.chat.as_mut()
        {
            chat.mentioned = true;
        }
        if let Some(chat) = task.chat.as_mut()
            && !chat.message_ids.iter().any(|id| id == message_id)
        {
            chat.message_ids.push(message_id.to_string());
            // 与 message_ids 同步成对推入：撤回时按下标摘行，两边不会错位。
            chat.lines.push(line.trim().to_string());
        }
        task.instruction.push('\n');
        task.instruction.push_str(line.trim());
        // 有人还在说：投递再往后顺延，这一整段一起送。
        task.due_at = now + CHAT_DEBOUNCE_MS;
        true
    }

    /// 撤回一条还没送出的群聊消息：把它从排队中的投递里摘掉。
    ///
    /// 只碰还在排队的投递——已经交给终端的撤不回来，这不是我们能决定的。
    /// 摘空了的投递整条撤掉；返回受影响的投递数。
    pub fn drop_pending_message(&self, message_id: &str) -> usize {
        let Ok(mut tasks) = self.tasks.lock() else {
            return 0;
        };
        let mut touched = 0;
        let mut empty: Vec<String> = Vec::new();
        for task in tasks.values_mut() {
            if task.state != TaskState::Queued {
                continue;
            }
            let (now_empty, rebuilt) = {
                let Some(chat) = task.chat.as_mut() else {
                    continue;
                };
                let Some(index) = chat.message_ids.iter().position(|id| id == message_id) else {
                    continue;
                };
                chat.message_ids.remove(index);
                if index < chat.lines.len() {
                    chat.lines.remove(index);
                }
                (chat.message_ids.is_empty(), chat.lines.join("\n"))
            };
            task.instruction = rebuilt;
            touched += 1;
            if now_empty {
                empty.push(task.id.clone());
            }
        }
        for id in &empty {
            tasks.remove(id);
        }
        touched
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
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis() as i64)
            .unwrap_or_default();
        self.tasks
            .lock()
            .map(|tasks| {
                let mut queued: Vec<CollabTask> = tasks
                    .values()
                    .filter(|task| task.state == TaskState::Queued)
                    // 防抖期没到就先攒着：等安静下来整段送出。
                    .filter(|task| task.due_at <= now)
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

    /// 收掉一条任务。群聊投递在回执写回时间线后由对账立即回收，避免只增不减。
    pub fn remove(&self, id: &str) {
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.remove(id);
        }
    }

    /// 停掉一条指定任务（房间视图的「停止」用）。
    ///
    /// 只有还没结的任务可停；已经交给终端的拦不回来——和 `stop_all` 同一条
    /// 边界：停止只能保证不再有新的推进，不能把已经打进对方终端的字收回来。
    pub fn stop(&self, id: &str) -> Result<CollabTask, String> {
        let Ok(mut tasks) = self.tasks.lock() else {
            return Err("任务表锁不上".into());
        };
        let Some(task) = tasks.get_mut(id) else {
            return Err(format!("没有编号 {id} 的任务"));
        };
        if !matches!(
            task.state,
            TaskState::PendingApproval | TaskState::Queued | TaskState::Dispatched
        ) {
            return Err("这条任务已经结了".into());
        }
        task.state = TaskState::Abandoned;
        task.result = Some("用户停止了这条任务".into());
        Ok(task.clone())
    }

    /// 用户点头，放行投递。
    ///
    /// 只放行还在等的：已经拒掉或结掉的不该被一次误点改回去。
    pub fn approve(&self, id: &str) -> Result<CollabTask, String> {
        let Ok(mut tasks) = self.tasks.lock() else {
            return Err("任务表锁不上".into());
        };
        let Some(task) = tasks.get_mut(id) else {
            return Err(format!("没有编号 {id} 的任务"));
        };
        if task.state != TaskState::PendingApproval {
            return Err("这条任务不在等确认".into());
        }
        task.state = TaskState::Queued;
        Ok(task.clone())
    }

    /// 用户否掉一条待确认的任务。
    pub fn reject(&self, id: &str) -> Result<CollabTask, String> {
        let Ok(mut tasks) = self.tasks.lock() else {
            return Err("任务表锁不上".into());
        };
        let Some(task) = tasks.get_mut(id) else {
            return Err(format!("没有编号 {id} 的任务"));
        };
        if task.state != TaskState::PendingApproval {
            return Err("这条任务不在等确认".into());
        }
        task.state = TaskState::Abandoned;
        task.result = Some("用户拒绝了这条派活".into());
        Ok(task.clone())
    }

    /// 一键全停。
    ///
    /// 比任何单条操作都重要：协作跑飞时用户需要一个不用想、不用挑的出口。
    /// 已经交给终端的拦不回来，但至少不再有新的进去。
    pub fn stop_all(&self) -> usize {
        let Ok(mut tasks) = self.tasks.lock() else {
            return 0;
        };
        // 群聊不是可「停」的工作：直接清掉，不占用「已停止」的账。
        tasks.retain(|_, task| task.chat.is_none());
        let mut stopped = 0;
        for task in tasks.values_mut() {
            if matches!(
                task.state,
                TaskState::PendingApproval | TaskState::Queued | TaskState::Dispatched
            ) {
                task.state = TaskState::Abandoned;
                task.result = Some("用户中止了协作".into());
                stopped += 1;
            }
        }
        stopped
    }

    /// 某条会话作为接收方还没结的任务。用来在会话关闭时收尾。
    pub fn abandon_for(&self, tab_id: &str) {
        if let Ok(mut tasks) = self.tasks.lock() {
            // 群聊投递没有终态：目标没了就直接移除，别留成永远挂着的空壳。
            tasks.retain(|_, task| !(task.to == tab_id && task.chat.is_some()));
            for task in tasks.values_mut() {
                if task.to == tab_id
                    && matches!(
                        task.state,
                        TaskState::PendingApproval | TaskState::Queued | TaskState::Dispatched
                    )
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
                    // 群聊投递不占派活预算：闲聊不该把「这一轮还能派几条」吃掉。
                    .filter(|task| {
                        task.chat.is_none() && task.path.first().is_some_and(|first| first == root)
                    })
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
