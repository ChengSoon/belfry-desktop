//! 房间上的每一个动作：发消息、改简报、动任务板、管成员。
//!
//! 全部是 `&mut Room` 上的纯函数，不碰磁盘也不碰投递：存储层负责落盘，
//! 投递层负责把 `Posted` 送进成员终端。消息只经 `post` 一个入口落进账本投影，
//! 运行时与重启后重放走同一段代码。
//!
//! 协作规则照 CCCC（Apache-2.0，见 `third_party/cccc/NOTICE.md`）：统筹改简报、给任何人
//! 派活、重开与归档任务；成员只能动自己的任务、认领没人接的任务，不能给别的成员派活。
//! 任务分派、完成、解锁时自动给相关的人发注记——统筹不用盯着屏幕也知道进度。

use super::attachments::RoomAttachment;
use super::ledger;
use super::model::*;

/// 一条要送进成员终端的消息。`to` 里的 `user` 不投递（用户在界面上看）。
#[derive(Clone, Debug, PartialEq)]
pub struct Posted {
    pub message_id: String,
    pub to: Vec<String>,
}

pub const MAX_ROOM_NAME_CHARS: usize = 40;
pub const MAX_TASK_TITLE_CHARS: usize = 80;
const MAX_NOTES_CHARS: usize = 4000;
/// 角色名不能和收件人记号撞车，否则 `@统筹` 指谁就说不清了。
const RESERVED_TITLES: &[&str] = &["统筹", "全体", "成员", "用户", "系统", "all", "peers", "foreman", "user", "system"];

#[allow(clippy::too_many_arguments)]
fn post(
    room: &mut Room,
    kind: MessageKind,
    by: &str,
    text: String,
    to: Vec<String>,
    mode: MessageMode,
    reply_to: Option<String>,
    attachments: Vec<RoomAttachment>,
    now: i64,
) -> Posted {
    let message = Message {
        id: new_id(),
        at: now,
        kind,
        by: by.to_string(),
        text,
        to: to.clone(),
        mode,
        reply_to,
        attachments,
        delivered_to: Vec::new(),
        replied_by: Vec::new(),
        reply_cancelled: false,
    };
    let event = ledger::message_event(&room.id, &message);
    ledger::apply(room, &event);
    room.pending.push(event);
    Posted { message_id: message.id, to }
}

/// 系统注记。`to` 为空时只记在时间线上，不打扰任何人。
fn notice(room: &mut Room, text: String, to: Vec<String>, now: i64) -> Posted {
    post(room, MessageKind::Notice, "system", text, to, MessageMode::Send, None, Vec::new(), now)
}

fn others(room: &Room, except: &str) -> Vec<String> {
    room.active_members()
        .filter(|member| member.id != except)
        .map(|member| member.id.clone())
        .collect()
}

/// 给角色发的上手说明。注入成员终端的第一条消息，决定它在房间里怎么做事。
fn onboarding(room: &Room, member: &Member) -> String {
    let objective = if room.brief.objective.trim().is_empty() {
        "还没写".to_string()
    } else {
        excerpt(&room.brief.objective, 120)
    };
    let duty = if member.duty.trim().is_empty() { "（未写）" } else { member.duty.trim() };
    let role = match member.role {
        MemberRole::Foreman => "你是统筹：你的主要工作是协调，不是自己动手。收到需求先看 belfry room status，\
把需求拆成任务、按职责派给成员（belfry room task add <标题> --to <角色> --outcome <完成标准>）；\
只有很小的活、或者没有合适的成员时才自己做。派活只用任务板，不要用 belfry send。\
成员完成任务或手上没活时你会收到通知，据此派下一件；全部完成后用 belfry room say --to @用户 汇报。",
        MemberRole::Peer => "你是成员：做好自己职责内的任务，开工 belfry room task start <任务号>，\
完成 belfry room task done <任务号> <结果>；发现问题或需要别人配合，跟统筹说（belfry room say <内容>）。",
    };
    format!(
        "你加入了房间「{}」，角色「{}」，职责：{duty}。需求目标：{objective}。\n{role}\n全貌（需求、成员、任务板）：belfry room status",
        room.name, member.title
    )
}

fn validate_title(room: &Room, raw: &str, except: Option<&str>) -> Result<String, String> {
    let title = raw.trim().trim_start_matches('@').trim().to_string();
    if title.is_empty() {
        return Err("角色名是必填的".to_string());
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("角色名最多 {MAX_TITLE_CHARS} 个字"));
    }
    if title.chars().any(char::is_whitespace) {
        return Err("角色名不能带空格：点名时 @ 后面要能一口气写完".to_string());
    }
    if RESERVED_TITLES.iter().any(|reserved| reserved.eq_ignore_ascii_case(&title)) {
        return Err(format!("「{title}」是收件人记号，换个角色名"));
    }
    let taken = room.active_members().any(|member| {
        Some(member.id.as_str()) != except && member.title.to_lowercase() == title.to_lowercase()
    });
    if taken {
        return Err(format!("房间里已经有「{title}」了"));
    }
    Ok(title)
}

// ---- 成员（只有用户在界面上管） ----

pub fn add_member(
    room: &mut Room,
    tab_id: &str,
    agent: &str,
    title: &str,
    duty: &str,
    foreman: bool,
    now: i64,
) -> Result<(String, Vec<Posted>), String> {
    if room.member_by_tab(tab_id).is_some() {
        return Err("这条会话已经在房间里了".to_string());
    }
    let title = validate_title(room, title, None)?;
    // 第一位成员自动当统筹（CCCC：第一个启用的 actor 成为 foreman）。
    let becomes_foreman = foreman || room.foreman().is_none();
    let mut posted = Vec::new();
    if becomes_foreman && let Some(previous) = room.foreman().map(|member| member.id.clone()) {
        demote(room, &previous);
    }
    let id = new_id();
    room.members.push(Member {
        id: id.clone(),
        tab_id: tab_id.to_string(),
        agent: agent.to_string(),
        title: title.clone(),
        duty: duty.trim().to_string(),
        role: if becomes_foreman { MemberRole::Foreman } else { MemberRole::Peer },
        joined_at: now,
        left_at: None,
    });
    let member = room.active_member(&id).cloned().expect("刚加入");
    let role = if becomes_foreman { "统筹" } else { "成员" };
    posted.push(notice(room, format!("「{title}」以{role}身份加入了房间。"), Vec::new(), now));
    posted.push(notice(room, onboarding(room, &member), vec![id.clone()], now));
    Ok((id, posted))
}

fn demote(room: &mut Room, member_id: &str) {
    if let Some(member) = room.members.iter_mut().find(|member| member.id == member_id) {
        member.role = MemberRole::Peer;
    }
}

pub fn set_foreman(room: &mut Room, member_id: &str, now: i64) -> Result<Vec<Posted>, String> {
    let member = room.active_member(member_id).cloned().ok_or("找不到这位成员（或已离开）")?;
    if member.role == MemberRole::Foreman {
        return Err(format!("「{}」已经是统筹了", member.title));
    }
    let previous = room.foreman().cloned();
    if let Some(previous) = &previous {
        demote(room, &previous.id);
    }
    if let Some(target) = room.members.iter_mut().find(|candidate| candidate.id == member_id) {
        target.role = MemberRole::Foreman;
    }
    let promoted = room.active_member(member_id).cloned().expect("刚查过");
    let mut posted = vec![notice(room, format!("「{}」现在是统筹。", promoted.title), Vec::new(), now)];
    posted.push(notice(room, onboarding(room, &promoted), vec![promoted.id.clone()], now));
    if let Some(previous) = previous {
        posted.push(notice(
            room,
            format!("统筹换成了「{}」，你现在是成员，手上的任务照常做。", promoted.title),
            vec![previous.id],
            now,
        ));
    }
    Ok(posted)
}

pub fn update_member(
    room: &mut Room,
    member_id: &str,
    title: Option<&str>,
    duty: Option<&str>,
    tab_id: Option<&str>,
    now: i64,
) -> Result<Vec<Posted>, String> {
    let current = room.active_member(member_id).cloned().ok_or("找不到这位成员（或已离开）")?;
    let title = title.map(|raw| validate_title(room, raw, Some(member_id))).transpose()?;
    if let Some(tab) = tab_id
        && room.active_members().any(|member| member.tab_id == tab && member.id != member_id)
    {
        return Err("这条会话已经是另一位成员了".to_string());
    }
    let member = room.members.iter_mut().find(|member| member.id == member_id).expect("刚查过");
    if let Some(title) = &title {
        member.title = title.clone();
    }
    if let Some(duty) = duty {
        member.duty = duty.trim().to_string();
    }
    if let Some(tab) = tab_id {
        member.tab_id = tab.to_string();
    }
    let mut posted = Vec::new();
    if let Some(title) = title.filter(|title| *title != current.title) {
        posted.push(notice(room, format!("「{}」改名为「{title}」。", current.title), Vec::new(), now));
    }
    // 换了会话：新会话对房间一无所知，重发一遍上手说明。
    if tab_id.is_some_and(|tab| tab != current.tab_id) {
        let member = room.active_member(member_id).cloned().expect("刚查过");
        posted.push(notice(room, onboarding(room, &member), vec![member.id.clone()], now));
    }
    Ok(posted)
}

pub fn remove_member(room: &mut Room, member_id: &str, now: i64) -> Result<Vec<Posted>, String> {
    let leaving = room.active_member(member_id).cloned().ok_or("找不到这位成员（或已离开）")?;
    if let Some(member) = room.members.iter_mut().find(|member| member.id == member_id) {
        member.left_at = Some(now);
    }
    let mut posted = vec![notice(room, format!("「{}」离开了房间。", leaving.title), Vec::new(), now)];
    // 统筹走了：最早加入的在场成员接任，不让房间失去统筹。
    if leaving.role == MemberRole::Foreman {
        demote(room, member_id);
        let next = room.active_members().min_by_key(|member| member.joined_at).map(|member| member.id.clone());
        if let Some(next) = next {
            posted.extend(set_foreman(room, &next, now)?);
        }
    }
    // 他手上没做完的活交还给统筹重新分。
    let orphaned: Vec<String> = room
        .tasks
        .iter_mut()
        .filter(|task| {
            task.assignee.as_deref() == Some(member_id)
                && matches!(task.status, TaskStatus::Planned | TaskStatus::Active)
        })
        .map(|task| {
            task.assignee = None;
            task.status = TaskStatus::Planned;
            task.rev += 1;
            task.updated_at = now;
            task.id.clone()
        })
        .collect();
    if !orphaned.is_empty() {
        let to = room.foreman().map(|member| vec![member.id.clone()]).unwrap_or_default();
        posted.push(notice(
            room,
            format!("「{}」离开后 {} 没人负责了，请重新分派。", leaving.title, orphaned.join("、")),
            to,
            now,
        ));
    }
    Ok(posted)
}

// ---- 需求简报 ----

pub fn update_brief(
    room: &mut Room,
    actor: &Actor,
    objective: Option<&str>,
    focus: Option<&str>,
    constraints: Option<Vec<String>>,
    now: i64,
) -> Result<Posted, String> {
    if !actor.coordinates() {
        return Err("需求简报只有统筹和用户能改；有想法跟统筹说".to_string());
    }
    if objective.is_none() && focus.is_none() && constraints.is_none() {
        return Err("要改哪一项？目标、当前重点、约束至少给一个".to_string());
    }
    let brief = &mut room.brief;
    if let Some(value) = objective {
        brief.objective = value.trim().to_string();
    }
    if let Some(value) = focus {
        brief.current_focus = value.trim().to_string();
    }
    if let Some(list) = constraints {
        brief.constraints = list.into_iter().map(|item| item.trim().to_string()).filter(|item| !item.is_empty()).collect();
    }
    brief.updated_by = Some(actor.id().to_string());
    brief.updated_at = Some(now);
    let mut parts = Vec::new();
    if let Some(value) = objective {
        parts.push(format!("目标：{}", excerpt(value, 200)));
    }
    if let Some(value) = focus {
        parts.push(format!("当前重点：{}", excerpt(value, 200)));
    }
    if !room.brief.constraints.is_empty() && parts.len() < 2 {
        parts.push(format!("约束：{}", room.brief.constraints.join("；")));
    }
    let text = format!("{}更新了需求简报。{}", room.label(actor.id()), parts.join("；"));
    let to = others(room, actor.id());
    Ok(notice(room, text, to, now))
}

// ---- 消息 ----

pub fn say(
    room: &mut Room,
    actor: &Actor,
    tokens: &[String],
    text: &str,
    reply_hint: Option<&str>,
    ask: bool,
    now: i64,
) -> Result<Posted, String> {
    say_with(room, actor, tokens, text, reply_hint, ask, Vec::new(), now)
}

/// 发一条带附件的消息。有附件时正文可以为空；收件人只按正文解析，文件名里的 @ 不算点名。
#[allow(clippy::too_many_arguments)]
pub fn say_with(
    room: &mut Room,
    actor: &Actor,
    tokens: &[String],
    text: &str,
    reply_hint: Option<&str>,
    ask: bool,
    attachments: Vec<RoomAttachment>,
    now: i64,
) -> Result<Posted, String> {
    let text = text.trim();
    if text.is_empty() && attachments.is_empty() {
        return Err("说点什么再发".to_string());
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(format!("一条消息最多 {MAX_TEXT_CHARS} 字"));
    }
    let target = match reply_hint.map(str::trim).filter(|hint| !hint.is_empty()) {
        None => None,
        Some(hint) => Some(
            room.message(hint)
                .cloned()
                .ok_or_else(|| format!("没有编号 {hint} 的消息，用 belfry room log 看看"))?,
        ),
    };
    if ask && target.is_some() {
        // CCCS：回复不能再要求回复，免得义务一层套一层。
        return Err("回复不能再要求回复；要追问就另发一条".to_string());
    }
    let implicit = tokens.iter().all(|token| token.trim().is_empty()) && mentions_in(room, text).is_empty();
    let to = match &target {
        // 回复不写收件人时回给原发件人。
        Some(original)
            if implicit
                && original.by != "system"
                && original.by != actor.id()
                && (original.by == "user" || room.active_member(&original.by).is_some()) =>
        {
            vec![original.by.clone()]
        }
        _ => resolve_recipients(room, actor, tokens, text)?,
    };
    if ask && to.iter().any(|id| id == "user") {
        return Err("要求回复只能发给成员；问用户直接发给 @用户 就行".to_string());
    }
    let mode = if ask { MessageMode::RequestReply } else { MessageMode::Send };
    let by = actor.id().to_string();
    Ok(post(room, MessageKind::Chat, &by, text.to_string(), to, mode, target.map(|message| message.id), attachments, now))
}

/// 撤销「要求回复」：还没回的人不用再回了。只有原发件人和用户能撤。
pub fn cancel_reply(room: &mut Room, actor: &Actor, hint: &str, now: i64) -> Result<(), String> {
    let message = room.message(hint).cloned().ok_or_else(|| format!("没有编号 {hint} 的消息"))?;
    if message.mode != MessageMode::RequestReply || message.reply_cancelled {
        return Err("这条消息没有在等回复".to_string());
    }
    if !matches!(actor, Actor::User) && message.by != actor.id() {
        return Err("只有发这条消息的人能撤销回复请求".to_string());
    }
    let event = ledger::cancel_event(&room.id, &message.id, actor.id(), now);
    ledger::apply(room, &event);
    room.pending.push(event);
    Ok(())
}

/// 记一笔送达。已经记过的不重复记。
pub fn record_delivery(room: &mut Room, message_id: &str, member_id: &str, now: i64) -> bool {
    let fresh = room
        .messages
        .iter()
        .any(|message| message.id == message_id && !message.delivered_to.iter().any(|id| id == member_id));
    if fresh {
        let event = ledger::delivery_event(&room.id, message_id, member_id, now);
        ledger::apply(room, &event);
        room.pending.push(event);
    }
    fresh
}

// ---- 暂停 ----

/// 暂停或恢复房间。暂停期间消息只记在时间线上，不送进成员终端；恢复后不补发，避免一次涌进一堆旧消息。
pub fn set_paused(room: &mut Room, paused: bool, now: i64) -> Result<Posted, String> {
    if room.paused == paused {
        return Err(if paused { "房间已经暂停了".to_string() } else { "房间没有暂停".to_string() });
    }
    room.paused = paused;
    let text = if paused {
        "你暂停了房间：之后的消息只记在房间里，不再送进成员终端，空闲提醒也停了。成员手上正在做的不会被打断。"
    } else {
        "你恢复了房间：新消息照常送进成员终端。暂停期间的消息不会补发，需要的话再说一遍。"
    };
    Ok(notice(room, text.to_string(), Vec::new(), now))
}

// ---- 空闲提醒 ----

/// 房间安静多久之后提醒统筹（CCCC 的 actor_idle / silence_check）。
pub const IDLE_NUDGE_MS: i64 = 3 * 60_000;
/// 空闲提醒的开头。算「房间最后一次动静」时跳过它们，提醒本身不算动静。
pub const IDLE_NUDGE_PREFIX: &str = "【空闲提醒】";

/// 有成员手上没活、会话也闲着，而房间已经安静了一阵：提醒统筹一次。
///
/// 同一段安静只提醒一次（`idle_nudged_after` 记着那段安静从何时开始）；统筹在等用户回话、
/// 或者自己正忙时不提醒。提醒是注记，成员之间不会因此互相触发，不会形成自动循环。
pub fn idle_nudge(room: &mut Room, session_idle: &dyn Fn(&Member) -> bool, now: i64) -> Option<Posted> {
    if room.paused {
        return None;
    }
    let foreman = room.foreman()?.clone();
    if !session_idle(&foreman) {
        return None;
    }
    let chats: Vec<&Message> = room.messages.iter().filter(|message| message.kind == MessageKind::Chat).collect();
    // 还没人提过需求，或者最后一句是统筹在问用户 / 向用户汇报：在等用户，不催。
    let last_chat = chats.last()?;
    if !chats.iter().any(|message| message.by == "user") || (last_chat.by == foreman.id && last_chat.to == ["user"]) {
        return None;
    }
    let last = room
        .messages
        .iter()
        .filter(|message| !(message.kind == MessageKind::Notice && message.text.starts_with(IDLE_NUDGE_PREFIX)))
        .map(|message| message.at)
        .chain(room.tasks.iter().map(|task| task.updated_at))
        .max()?;
    if now - last < IDLE_NUDGE_MS || room.idle_nudged_after == Some(last) {
        return None;
    }
    let idle: Vec<String> = room
        .active_members()
        .filter(|member| member.role == MemberRole::Peer && workload(room, &member.id) == 0 && session_idle(member))
        .map(|member| member.title.clone())
        .collect();
    if idle.is_empty() {
        return None;
    }
    room.idle_nudged_after = Some(last);
    let text = format!(
        "{IDLE_NUDGE_PREFIX}「{}」手上没有任务，房间已经安静 {} 分钟。还有要做的就拆成任务派给他们\
（belfry room task add <标题> --to <角色>）；没有就不用回复。",
        idle.join("」「"),
        (now - last) / 60_000
    );
    Some(notice(room, text, vec![foreman.id], now))
}

// ---- 任务板 ----

fn task_mut<'a>(room: &'a mut Room, raw: &str) -> Result<&'a mut Task, String> {
    let index = room
        .task_index(raw)
        .ok_or_else(|| format!("没有任务 {}，用 belfry room status 看任务板", raw.trim()))?;
    Ok(&mut room.tasks[index])
}

fn assignee_id(room: &Room, title: Option<&str>) -> Result<Option<String>, String> {
    match title.map(str::trim).filter(|title| !title.is_empty()) {
        None => Ok(None),
        Some(title) => room
            .member_by_title(title)
            .map(|member| Some(member.id.clone()))
            .ok_or_else(|| format!("房间里没有「{}」", title.trim_start_matches('@'))),
    }
}

fn touch(task: &mut Task, now: i64) {
    task.rev += 1;
    task.updated_at = now;
}

fn foreman_unless(room: &Room, actor: &Actor) -> Vec<String> {
    match room.foreman() {
        Some(foreman) if foreman.id != actor.id() => vec![foreman.id.clone()],
        _ => Vec::new(),
    }
}

pub fn task_add(
    room: &mut Room,
    actor: &Actor,
    title: &str,
    outcome: Option<&str>,
    assignee: Option<&str>,
    after: &[String],
    now: i64,
) -> Result<(String, Vec<Posted>), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("任务要有标题".to_string());
    }
    if title.chars().count() > MAX_TASK_TITLE_CHARS {
        return Err(format!("任务标题最多 {MAX_TASK_TITLE_CHARS} 个字；细节写进 --outcome"));
    }
    let assignee = assignee_id(room, assignee)?;
    may_assign(room, actor, assignee.as_deref())?;
    let mut blocked_by = Vec::new();
    for raw in after {
        let id = normalize_task_id(raw).ok_or_else(|| format!("「{raw}」不是任务号（写成 T1 这样）"))?;
        if room.task_index(&id).is_none() {
            return Err(format!("没有任务 {id}"));
        }
        if !blocked_by.contains(&id) {
            blocked_by.push(id);
        }
    }
    let id = format!("T{}", room.next_task);
    room.next_task += 1;
    room.tasks.push(Task {
        id: id.clone(),
        title: title.to_string(),
        outcome: outcome.unwrap_or_default().trim().to_string(),
        status: TaskStatus::Planned,
        assignee: assignee.clone(),
        blocked_by: blocked_by.clone(),
        notes: String::new(),
        result: None,
        created_by: actor.id().to_string(),
        created_at: now,
        updated_at: now,
        rev: 1,
    });
    let mut text = format!("{}新建了 {id}「{title}」", room.label(actor.id()));
    match &assignee {
        Some(member) => text.push_str(&format!("，交给「{}」", room.label(member))),
        None => text.push_str("，还没人负责"),
    }
    if !blocked_by.is_empty() {
        text.push_str(&format!("，要等 {} 完成", blocked_by.join("、")));
    }
    if let Some(outcome) = outcome.map(str::trim).filter(|value| !value.is_empty()) {
        text.push_str(&format!("。完成标准：{}", excerpt(outcome, 200)));
    }
    text.push('。');
    let mut to: Vec<String> = assignee.into_iter().filter(|member| member != actor.id()).collect();
    // 成员自己建的任务也让统筹知道，任务板上不出现统筹不知情的活。
    if !actor.coordinates() {
        to.extend(foreman_unless(room, actor));
    }
    to.dedup();
    let posted = notice(room, text, to, now);
    Ok((id, vec![posted]))
}

pub fn task_assign(room: &mut Room, actor: &Actor, raw: &str, assignee: &str, now: i64) -> Result<Vec<Posted>, String> {
    let assignee = assignee_id(room, Some(assignee))?.ok_or("要写交给谁")?;
    let snapshot = room.tasks[room.task_index(raw).ok_or_else(|| format!("没有任务 {}", raw.trim()))?].clone();
    if matches!(snapshot.status, TaskStatus::Done | TaskStatus::Archived) {
        return Err(format!("{} 已经{}了", snapshot.id, snapshot.status.label()));
    }
    if !actor.coordinates() {
        // 成员只能把没人接的任务认领给自己。
        if snapshot.assignee.is_some() || assignee != actor.id() {
            return Err("成员只能认领没人负责的任务给自己；换人跟统筹说".to_string());
        }
    }
    if snapshot.assignee.as_deref() == Some(assignee.as_str()) {
        return Err(format!("{} 已经是「{}」负责的了", snapshot.id, room.label(&assignee)));
    }
    let previous = snapshot.assignee.clone();
    let task = task_mut(room, raw)?;
    task.assignee = Some(assignee.clone());
    touch(task, now);
    let id = task.id.clone();
    let title = task.title.clone();
    let mut posted = Vec::new();
    let actor_label = room.label(actor.id());
    let assignee_label = room.label(&assignee);
    let text = if assignee == actor.id() {
        format!("{actor_label}认领了 {id}「{title}」。")
    } else {
        format!("{actor_label}把 {id}「{title}」交给了「{assignee_label}」。")
    };
    let mut to: Vec<String> = vec![assignee.clone()];
    to.retain(|member| member != actor.id());
    if !actor.coordinates() {
        to.extend(foreman_unless(room, actor));
    }
    if let Some(previous) = previous.filter(|previous| previous != actor.id() && *previous != assignee) {
        to.push(previous);
    }
    posted.push(notice(room, text, to, now));
    Ok(posted)
}

pub fn task_start(room: &mut Room, actor: &Actor, raw: &str, now: i64) -> Result<Vec<Posted>, String> {
    let index = room.task_index(raw).ok_or_else(|| format!("没有任务 {}", raw.trim()))?;
    let snapshot = room.tasks[index].clone();
    may_work_on(actor, &snapshot)?;
    check_move(actor, snapshot.status, TaskStatus::Active)?;
    let waiting = open_blockers(room, &snapshot);
    if !waiting.is_empty() {
        return Err(format!("{} 还在等 {} 完成", snapshot.id, waiting.join("、")));
    }
    let task = &mut room.tasks[index];
    task.status = TaskStatus::Active;
    if task.assignee.is_none() && let Actor::Member(member) = actor {
        task.assignee = Some(member.id.clone());
    }
    touch(task, now);
    let text = format!("{}开始做 {}「{}」。", room.label(actor.id()), snapshot.id, snapshot.title);
    Ok(vec![notice(room, text, Vec::new(), now)])
}

pub fn task_done(room: &mut Room, actor: &Actor, raw: &str, result: Option<&str>, now: i64) -> Result<Vec<Posted>, String> {
    let index = room.task_index(raw).ok_or_else(|| format!("没有任务 {}", raw.trim()))?;
    let snapshot = room.tasks[index].clone();
    may_work_on(actor, &snapshot)?;
    check_move(actor, snapshot.status, TaskStatus::Done)?;
    let waiting = open_blockers(room, &snapshot);
    if !waiting.is_empty() {
        return Err(format!("{} 还在等 {} 完成", snapshot.id, waiting.join("、")));
    }
    let result = result.map(str::trim).filter(|value| !value.is_empty()).map(String::from);
    let task = &mut room.tasks[index];
    task.status = TaskStatus::Done;
    task.result = result.clone();
    if task.assignee.is_none() && let Actor::Member(member) = actor {
        task.assignee = Some(member.id.clone());
    }
    touch(task, now);
    let worker = room.tasks[index].assignee.clone();
    let mut posted = Vec::new();
    let mut text = format!("{}完成了 {}「{}」", room.label(actor.id()), snapshot.id, snapshot.title);
    match &result {
        Some(result) => text.push_str(&format!("：{}", excerpt(result, 300))),
        None => text.push('。'),
    }
    // CCCC 的 actor_idle：负责人手上没活了，统筹该知道，好派下一件。
    if let Some(worker) = &worker {
        let idle = !room.tasks.iter().any(|task| {
            task.assignee.as_deref() == Some(worker.as_str())
                && matches!(task.status, TaskStatus::Planned | TaskStatus::Active)
        });
        if idle && room.active_member(worker).is_some_and(|member| member.role == MemberRole::Peer) {
            text.push_str(&format!("「{}」手上没有别的活了。", room.label(worker)));
        }
    }
    let open = room.tasks.iter().filter(|task| matches!(task.status, TaskStatus::Planned | TaskStatus::Active)).count();
    if open == 0 {
        text.push_str("任务板上的活都完成了。");
    }
    let to = foreman_unless(room, actor);
    posted.push(notice(room, text, to, now));
    // 前置全部完成的任务：通知它的负责人可以开工。
    let unlocked: Vec<(String, String, String)> = room
        .tasks
        .iter()
        .filter(|task| task.status == TaskStatus::Planned && task.blocked_by.contains(&snapshot.id))
        .filter(|task| open_blockers(room, task).is_empty())
        .filter_map(|task| task.assignee.clone().map(|member| (member, task.id.clone(), task.title.clone())))
        .collect();
    for (member, id, title) in unlocked {
        if member != actor.id() {
            posted.push(notice(
                room,
                format!("{id}「{title}」的前置都完成了，可以开工：belfry room task start {id}"),
                vec![member],
                now,
            ));
        }
    }
    Ok(posted)
}

pub fn task_reopen(room: &mut Room, actor: &Actor, raw: &str, now: i64) -> Result<Vec<Posted>, String> {
    let index = room.task_index(raw).ok_or_else(|| format!("没有任务 {}", raw.trim()))?;
    let snapshot = room.tasks[index].clone();
    may_work_on(actor, &snapshot)?;
    check_move(actor, snapshot.status, TaskStatus::Planned)?;
    let task = &mut room.tasks[index];
    task.status = TaskStatus::Planned;
    if snapshot.status == TaskStatus::Done {
        task.result = None;
    }
    touch(task, now);
    let text = format!("{}把 {}「{}」退回待开工。", room.label(actor.id()), snapshot.id, snapshot.title);
    let to: Vec<String> = snapshot.assignee.into_iter().filter(|member| member != actor.id()).collect();
    Ok(vec![notice(room, text, to, now)])
}

pub fn task_note(room: &mut Room, actor: &Actor, raw: &str, text: &str, now: i64) -> Result<Vec<Posted>, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("备注是空的".to_string());
    }
    let index = room.task_index(raw).ok_or_else(|| format!("没有任务 {}", raw.trim()))?;
    may_work_on(actor, &room.tasks[index])?;
    let label = room.label(actor.id());
    let task = &mut room.tasks[index];
    if !task.notes.is_empty() {
        task.notes.push('\n');
    }
    task.notes.push_str(&format!("{label}：{text}"));
    // 只留最近的一段：备注是进展，不是归档。
    let count = task.notes.chars().count();
    if count > MAX_NOTES_CHARS {
        task.notes = task.notes.chars().skip(count - MAX_NOTES_CHARS).collect();
    }
    touch(task, now);
    Ok(Vec::new())
}

pub fn task_archive(room: &mut Room, actor: &Actor, raw: &str, now: i64) -> Result<Vec<Posted>, String> {
    let index = room.task_index(raw).ok_or_else(|| format!("没有任务 {}", raw.trim()))?;
    let snapshot = room.tasks[index].clone();
    check_move(actor, snapshot.status, TaskStatus::Archived)?;
    let task = &mut room.tasks[index];
    task.status = TaskStatus::Archived;
    touch(task, now);
    let text = format!("{}归档了 {}「{}」。", room.label(actor.id()), snapshot.id, snapshot.title);
    Ok(vec![notice(room, text, Vec::new(), now)])
}
