//! 派活：一条会话让另一条会话去做点什么。
//!
//! 这个模块只管**任务本身**和**准不准派**，不碰传输也不碰投递。放在纯逻辑层
//! 是因为闸门是整个功能里最不能出错的部分：项目已经在用
//! `--dangerously-skip-permissions` 启动 Claude，能互相派活 + 跳过确认，
//! 一次误判就会变成一串会话连锁执行。这种东西必须能单测到每一条边界。

use serde::{Deserialize, Serialize};
#[path = "task_persistence.rs"]
mod persistence;
pub use persistence::TaskBoard;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeliveryPhase { #[default] Accepted, Queued, Submitting, Submitted, Uncertain, Cancelled }

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryReceipt {
    pub phase: DeliveryPhase,
    pub attempt_id: Option<String>,
    #[serde(default)]
    pub sequence: u64,
    pub message: Option<String>,
}

/// 一手能转几道。A→B→C→D 就停。
///
/// 不设上限的话，一个「你去找人帮忙」的指令可以无限转包下去；
/// 设成 3 是因为再深的链路人已经看不懂谁在替谁干活了。
pub const MAX_HOPS: u8 = 3;

/// 一轮协作里最多来回几条。
///
/// 环检测挡得住 A→B→A，挡不住 A→B、A→C、A→D…… 这种扇出。
pub const MAX_MESSAGES_PER_RUN: usize = 20;

/// 房间消息合并窗口：同一位接收者排队中的投递，这段时间内的新消息并进同一条
/// 注入——成员读到一段对话摘录，而不是被反复打断。
pub const CHAT_MERGE_WINDOW_MS: i64 = 20_000;

/// 房间消息防抖：连发期间投递一直往后顺延，等这一小段安静下来再整段送出——
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
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
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum TaskOrigin {
    Room { id: String, name: String },
}

/// 房间消息投递的语境。带它的「任务」只负责把消息送进目标终端：不进任务状态机
/// （没人需要 `belfry done`），也不进协作面板与 inbox——房间的活在房间任务板上。
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDelivery {
    /// 其中有消息要求对方回复。
    pub ask: bool,
    /// 这条投递承载的消息 id（连发合并会带多条）：送达后按它把回执写回时间线。
    pub message_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabTask {
    #[serde(default)]
    pub source_sequence: u64,
    #[serde(default)]
    pub project_root: Option<String>,
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
    /// 房间消息投递的语境；`None`＝普通任务（要交差的那一类）。
    #[serde(default)]
    pub chat: Option<ChatDelivery>,
    /// 早于它不进投递（毫秒）。普通任务为 0；房间消息带一小段防抖，
    /// 让连发并成一段再送出。
    #[serde(default)]
    pub due_at: i64,
    #[serde(default)]
    pub delivery: DeliveryReceipt,
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
        return Verdict::Rejected(belfry_i18n::text("指令是空的").into());
    }
    if request.from == request.to {
        // 自己派给自己会变成一个自己等自己的死结。
        return Verdict::Rejected(belfry_i18n::text("不能给自己派活").into());
    }
    if !target.exists {
        return Verdict::Rejected(belfry_i18n::text("目标会话不在了").into());
    }
    if !target.can_receive {
        return Verdict::Rejected(belfry_i18n::text("目标会话现在收不了指令（不是 Agent，或已退出）").into());
    }
    if !target.same_project {
        // 跨项目一律拒，连 Off 模式也不放行：这不是「危险但用户认了」，
        // 而是共享上下文和工作目录都对不上，派过去也做不对。
        return Verdict::Rejected(belfry_i18n::text("不能跨项目派活").into());
    }

    let hop = next_hop(request.parent);
    if hop > MAX_HOPS {
        return Verdict::Rejected(belfry_i18n::lformat!("转包层数超过上限（{MAX_HOPS} 手）"));
    }
    if let Some(parent) = request.parent
        && parent.path.iter().any(|node| node == request.to)
    {
        // A→B→A 这种环会让两条会话互相等待，谁也不会先动。
        return Verdict::Rejected(belfry_i18n::text("这条调用链里已经有目标会话了，会绕成环").into());
    }
    if messages_this_run >= MAX_MESSAGES_PER_RUN {
        return Verdict::Rejected(belfry_i18n::lformat!(
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
        source_sequence: 0,
        project_root: None,
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
        delivery: DeliveryReceipt::default(),
    }
}

/// 把一条房间消息排进接收者的投递。不经过 `judge`：房间成员资格就是用户的授权。
///
/// 同房间、同接收者、还在排队、窗口内的投递并成一段（要求回复只升级不降级），
/// 成员读到一段对话摘录，而不是被反复打断。
pub fn enqueue_room_post(board: &TaskBoard, from: &str, post: &super::RoomPost, now: i64) -> Result<(), String> {
    board.edit_mode(|tasks, enabled| {
    if enabled { return Ok(()); }
    if tasks.values().any(|task| task.to == post.tab_id && matches!(&task.origin, Some(TaskOrigin::Room { id, .. }) if id == &post.room_id)
        && task.chat.as_ref().is_some_and(|chat| chat.message_ids.contains(&post.message_id))) { return Ok(()); }
    let pending = tasks
        .values_mut()
        .filter(|task| {
            task.chat.is_some()
                && task.state == TaskState::Queued
                && task.delivery.phase == DeliveryPhase::Accepted && task.delivery.attempt_id.is_none()
                && task.instruction.len() + post.line.len() < 512 * 1024
                && task.to == post.tab_id
                && now - task.created_at <= CHAT_MERGE_WINDOW_MS
                && matches!(&task.origin, Some(TaskOrigin::Room { id, .. }) if id == &post.room_id)
        })
        .max_by_key(|task| task.created_at);
    if let Some(task) = pending {
        if let Some(chat) = task.chat.as_mut()
            && !chat.message_ids.contains(&post.message_id)
        {
            chat.message_ids.push(post.message_id.clone());
            chat.ask |= post.ask;
            task.instruction.push('\n');
            task.instruction.push_str(post.line.trim());
        }
        task.due_at = now + CHAT_DEBOUNCE_MS;
        return Ok(());
    }
    let id = ulid::Ulid::generate().to_string().to_lowercase();
    tasks.insert(
        id.clone(),
        CollabTask {
            source_sequence: 0,
            project_root: None,
            id,
            from: from.to_string(),
            to: post.tab_id.clone(),
            instruction: post.line.trim().to_string(),
            state: TaskState::Queued,
            hop: 1,
            path: vec![from.to_string(), post.tab_id.clone()],
            created_at: now,
            result: None,
            origin: Some(TaskOrigin::Room { id: post.room_id.clone(), name: post.room_name.clone() }),
            chat: Some(ChatDelivery { ask: post.ask, message_ids: vec![post.message_id.clone()] }),
            due_at: now + CHAT_DEBOUNCE_MS,
            delivery: DeliveryReceipt::default(),
        },
    );
    Ok(())
    })
}

pub fn display_state(task: &CollabTask) -> String {
    if task.state != TaskState::Queued { return format!("{:?}", task.state).to_lowercase(); }
    format!("{:?}", task.delivery.phase).to_lowercase()
}

/// 注入目标终端的文本。
///
/// 三行封顶。每个字都占目标 Agent 的上下文，还会污染它自己的对话——
/// 「入职说明」「工具清单」那类一次性铺垫属于它的 system prompt，不是我们该塞的。
pub fn injection_text(task: &CollabTask, from_label: &str) -> String {
    // 房间消息：没有任务号、没有 done 行——房间的活记在任务板上，不在这里交差。
    if let Some(chat) = &task.chat {
        let footer = if chat.ask {
            belfry_i18n::text("有消息要求你回复：belfry room say --reply <短id> <你的话>")
        } else {
            belfry_i18n::text("要接话用 belfry room say <你的话>（回复某条加 --reply <短id>）；没有要补充的不必回复。")
        };
        return belfry_i18n::lformat!("[belfry] 房间「{from_label}」：\n{}\n{footer}", task.instruction);
    }
    // 这行命令必须和 CLI 的实参语法逐字对上：`done` 收的是位置参数。写成
    // `--task <id>` 的话，Agent 照着敲会把 `--task` 当成任务号——真任务永远结不掉，
    // 而它自己以为已经交差了。e2e 测试会把这行原样跑一遍来钉住。
    belfry_i18n::lformat!(
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

#[cfg(test)]
#[path = "task_test.rs"]
mod tests;

#[cfg(test)]
#[path = "task_persistence_test.rs"]
mod persistence_tests;
