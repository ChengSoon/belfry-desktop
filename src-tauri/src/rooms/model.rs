//! 房间的数据模型与纯规则：角色、简报、任务板、消息投影、收件人解析、权限。
//!
//! 模型照 CCCC 的工作组（Apache-2.0，见 `third_party/cccc/NOTICE.md`）：一位统筹
//! （foreman）负责拆需求、派活、跟进度，自己也干活；成员（peer）各管一块职责，
//! 可以质疑统筹，但不能给别的成员派活。规则全放在这里，不碰磁盘也不碰投递，
//! 每条边界都能单测。

use serde::{Deserialize, Serialize};

use super::attachments::RoomAttachment;
use super::ledger::LedgerEvent;

/// 内存里每间房最多留多少条消息投影；更早的只在账本里。
pub const MAX_MESSAGES: usize = 1000;
pub const MAX_TEXT_CHARS: usize = 4000;
pub const MAX_TITLE_CHARS: usize = 24;

pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

pub(crate) fn new_id() -> String {
    ulid::Ulid::generate().to_string().to_lowercase()
}

/// 消息短 id（尾 8 位）：成员在终端里引用、回复都用它。取尾部是因为 ULID 头部是时间戳。
pub fn short_id(id: &str) -> String {
    let chars: Vec<char> = id.chars().collect();
    chars[chars.len().saturating_sub(8)..].iter().collect()
}

/// 压平空白、截断加省略号。注记和摘录用。
pub fn excerpt(text: &str, limit: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = flat.chars().take(limit).collect();
    if flat.chars().count() > limit {
        out.push('…');
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MemberRole {
    /// 统筹：拆需求、派活、跟进度，自己也干活。
    Foreman,
    /// 成员：负责自己的职责，可以质疑统筹，但只能管自己的任务。
    Peer,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    /// Preserve additive role settings across concurrent feature integration.
    #[serde(default, flatten)]
    pub extensions: std::collections::BTreeMap<String, serde_json::Value>,
    pub id: String,
    /// 绑定的会话。
    pub tab_id: String,
    /// claude / codex 等，开放字符串，房间层不比较取值。
    pub agent: String,
    /// 角色名，房间内唯一（在场成员之间）。点名、显示都用它。
    pub title: String,
    pub duty: String,
    /// 用户为此角色指定的启动模型；None 沿用项目/CLI 设置。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_override: Option<String>,
    pub role: MemberRole,
    pub joined_at: i64,
    #[serde(default)]
    pub left_at: Option<i64>,
}

/// 需求简报：大家共同的目标。只有统筹和用户能改（CCCC `coordination.brief.update`）。
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Brief {
    #[serde(default)]
    pub objective: String,
    #[serde(default)]
    pub current_focus: String,
    #[serde(default)]
    pub constraints: Vec<String>,
    #[serde(default)]
    pub updated_by: Option<String>,
    #[serde(default)]
    pub updated_at: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Planned,
    Active,
    Done,
    Archived,
}

impl TaskStatus {
    pub fn label(self) -> &'static str {
        match self {
            TaskStatus::Planned => belfry_i18n::text("待开工"),
            TaskStatus::Active => belfry_i18n::text("进行中"),
            TaskStatus::Done => belfry_i18n::text("已完成"),
            TaskStatus::Archived => belfry_i18n::text("已归档"),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    /// Assignment lifecycle, distinct from notes/status revision.
    #[serde(default)]
    pub generation: u64,
    /// `T<编号>`，房间内永不复用（CCCC 任务编号规则）。
    pub id: String,
    pub title: String,
    /// 做成什么样算完成。
    #[serde(default)]
    pub outcome: String,
    pub status: TaskStatus,
    /// 负责人 memberId；None＝还没人接。
    #[serde(default)]
    pub assignee: Option<String>,
    /// 要等这些任务完成才能开工。
    #[serde(default)]
    pub blocked_by: Vec<String>,
    #[serde(default)]
    pub notes: String,
    /// 交付时写的结果说明。
    #[serde(default)]
    pub result: Option<String>,
    /// `user` 或 memberId。
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// 每次改动加一。界面拿它判断看到的是不是最新版。
    pub rev: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageKind {
    Chat,
    /// 系统注记：任务分派、完成、简报更新、成员进出。
    Notice,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageMode {
    #[default]
    Send,
    /// 要求回复：每位收件人在回复之前都挂着「待回复」（CCCS `request_reply`）。
    RequestReply,
}

/// 时间线上的一条消息。由账本投影得到，当前投影随房间快照保存。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    #[serde(default)]
    pub inbox: Option<belfry_protocol::inbox::MessageSemantics>,
    pub id: String,
    pub at: i64,
    pub kind: MessageKind,
    /// `user`、`system` 或 memberId。
    pub by: String,
    pub text: String,
    /// 收件人：memberId，或 `user`。Notice 为空表示只记在时间线上。
    pub to: Vec<String>,
    pub mode: MessageMode,
    pub reply_to: Option<String>,
    /// 随消息发出的文件（房间自己的副本）。正文可以为空，只发附件。
    #[serde(default)]
    pub attachments: Vec<RoomAttachment>,
    /// 已进过哪些成员的终端。只记送达，读没读我们看不到。
    pub delivered_to: Vec<String>,
    /// 已回复的收件人（有人带 `reply_to` 回了这条）。
    pub replied_by: Vec<String>,
    pub reply_cancelled: bool,
}

impl Message {
    /// 还欠一句回复的收件人。
    pub fn awaiting(&self) -> Vec<String> {
        if self.reply_cancelled { return Vec::new(); }
        if let Some(semantics) = &self.inbox {
            return self.to.iter().filter(|recipient| **recipient != "user" && semantics.questions.iter().any(|question|
                question.recipients.contains(recipient) && !question.cancelled_for.contains(recipient)
                    && !question.replies.contains_key(*recipient))).cloned().collect();
        }
        if self.mode != MessageMode::RequestReply || self.reply_cancelled {
            return Vec::new();
        }
        self.to
            .iter()
            .filter(|id| *id != "user" && !self.replied_by.contains(id))
            .cloned()
            .collect()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    pub id: String,
    pub name: String,
    pub project_root: String,
    pub created_at: i64,
    pub brief: Brief,
    pub members: Vec<Member>,
    pub tasks: Vec<Task>,
    /// 下一个任务编号。只增不减：删掉的编号不会指向别的活。
    pub next_task: u32,
    /// 上次发空闲提醒时，房间最后一次动静的时刻。同一段安静只提醒一次。
    #[serde(default)]
    pub idle_nudged_after: Option<i64>,
    /// 暂停：消息照样记在房间里，但不送进成员终端，空闲提醒也停。协作跑偏时先停下来调整。
    #[serde(default)]
    pub paused: bool,
    /// 账本最近消息投影；与账本提交游标一起写入快照。
    #[serde(default)]
    pub messages: Vec<Message>,
    /// 最近窗口外仍待回复、未送达或被引用的消息，独立于 MAX_MESSAGES。
    #[serde(default)]
    pub retained_messages: Vec<Message>,
    /// 与房间动作同一次提交的待投递记录；正文仍由账本保存。
    #[serde(default)]
    pub delivery_outbox: Vec<RoomDelivery>,
    /// Acceptance receipts outlive the bounded message projection, so retrying
    /// an old operation cannot create a second message after history trimming.
    #[serde(default)]
    pub message_operations: std::collections::BTreeMap<String, MessageOperation>,
    /// 已提交账本字节数，供房间信息展示；不包含失败事务的尾部。
    #[serde(default)]
    pub ledger_bytes: u64,
    /// 已投影、还没追加进账本的事件。
    #[serde(skip)]
    pub(super) pending: Vec<LedgerEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageOperation {
    pub hash: String,
    pub posted: Vec<super::ops::Posted>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomDelivery {
    #[serde(default)]
    pub tab_id: Option<String>,
    pub message_id: String,
    pub member_id: String,
    #[serde(default)]
    pub phase: crate::collab::task::DeliveryPhase,
    pub message: Option<String>,
}

/// 谁在做这件事：用户（界面），或房间里的某位成员（CLI）。
#[derive(Clone, Copy, Debug)]
pub enum Actor<'a> {
    User,
    Member(&'a Member),
}

impl Actor<'_> {
    pub fn id(&self) -> &str {
        match self {
            Actor::User => "user",
            Actor::Member(member) => &member.id,
        }
    }

    /// 统筹与用户有协调权：改简报、给任何人派活、动任何任务。
    pub fn coordinates(&self) -> bool {
        match self {
            Actor::User => true,
            Actor::Member(member) => member.role == MemberRole::Foreman,
        }
    }
}

impl Room {
    pub fn all_messages(&self) -> impl DoubleEndedIterator<Item = &Message> {
        self.retained_messages.iter().chain(self.messages.iter())
    }

    pub fn message_mut(&mut self, id: &str) -> Option<&mut Message> {
        self.retained_messages.iter_mut().chain(self.messages.iter_mut()).find(|message| message.id == id)
    }

    pub fn trim_messages(&mut self) {
        let mut references: std::collections::HashSet<String> = self.all_messages().filter_map(|message| message.reply_to.clone()).collect();
        let answered: std::collections::HashSet<&String> = self.all_messages().flat_map(|message| message.inbox.iter().flat_map(|semantics| &semantics.answers)).collect();
        references.extend(self.all_messages().filter(|message| message.inbox.as_ref().is_some_and(|semantics| semantics.questions.iter().any(|question| answered.contains(&question.id)))).map(|message| message.id.clone()));
        let retain = |message: &Message| !message.awaiting().is_empty()
            || message.to.iter().any(|id| id != "user" && !message.delivered_to.contains(id))
            || references.contains(&message.id);
        self.retained_messages.retain(&retain);
        let overflow = self.messages.len().saturating_sub(MAX_MESSAGES);
        self.retained_messages.extend(self.messages.drain(..overflow).filter(retain));
    }
    pub fn active_members(&self) -> impl Iterator<Item = &Member> {
        self.members.iter().filter(|member| member.left_at.is_none())
    }

    pub fn active_member(&self, id: &str) -> Option<&Member> {
        self.active_members().find(|member| member.id == id)
    }

    pub fn member_by_tab(&self, tab_id: &str) -> Option<&Member> {
        self.active_members().find(|member| member.tab_id == tab_id)
    }

    pub fn foreman(&self) -> Option<&Member> {
        self.active_members().find(|member| member.role == MemberRole::Foreman)
    }

    /// 按角色名找在场成员。大小写不敏感，前面的 `@` 可有可无。
    pub fn member_by_title(&self, raw: &str) -> Option<&Member> {
        let name = raw.trim().trim_start_matches('@').trim().to_lowercase();
        self.active_members().find(|member| member.title.to_lowercase() == name)
    }

    /// 显示名：成员用角色名（离开的也认得出），用户与系统各有固定称呼。
    pub fn label(&self, id: &str) -> String {
        match id {
            "user" => belfry_i18n::text("用户").to_string(),
            "system" => belfry_i18n::text("系统").to_string(),
            _ => self
                .members
                .iter()
                .find(|member| member.id == id)
                .map(|member| member.title.clone())
                .unwrap_or_else(|| belfry_i18n::text("（已离开的成员）").to_string()),
        }
    }

    pub fn message(&self, hint: &str) -> Option<&Message> {
        let hint = hint.trim();
        self.all_messages()
            .rev()
            .find(|message| message.id == hint || short_id(&message.id) == hint)
    }

    pub fn task_index(&self, raw: &str) -> Option<usize> {
        let id = normalize_task_id(raw)?;
        self.tasks.iter().position(|task| task.id == id)
    }
}

/// `t3`、`3`、`T3` 都认成 `T3`。
pub fn normalize_task_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_start_matches(['T', 't']);
    let number: u32 = trimmed.parse().ok()?;
    Some(format!("T{number}"))
}

/// 默认收件人（CCCS `default_send_to`）：用户与成员不写收件人时发给统筹；
/// 统筹不写时发给全体成员。房间里还没有统筹时发给所有在场成员。
fn default_recipients(room: &Room, sender: &Actor) -> Vec<String> {
    let foreman = room.foreman().map(|member| member.id.clone());
    let is_foreman = matches!(sender, Actor::Member(member) if member.role == MemberRole::Foreman);
    match foreman {
        Some(id) if !is_foreman => vec![id],
        _ => room
            .active_members()
            .filter(|member| member.id != sender.id())
            .map(|member| member.id.clone())
            .collect(),
    }
}

/// 一个收件人记号展开成 memberId（或 `user`）。
fn expand_token(room: &Room, sender: &Actor, token: &str) -> Result<Vec<String>, String> {
    let others = |filter: &dyn Fn(&Member) -> bool| -> Vec<String> {
        room.active_members()
            .filter(|member| member.id != sender.id() && filter(member))
            .map(|member| member.id.clone())
            .collect()
    };
    let lowered = token.trim().to_lowercase();
    Ok(match lowered.as_str() {
        "@all" | "all" | "@全体" | "全体" => others(&|_| true),
        "@members" | "members" | "@peers" | "peers" | "@成员" | "成员" => others(&|member| member.role == MemberRole::Peer),
        "@coordinator" | "coordinator" | "@foreman" | "foreman" | "@统筹" | "统筹" => others(&|member| member.role == MemberRole::Foreman),
        "@user" | "user" | "@用户" | "用户" => vec!["user".to_string()],
        _ => match room.member_by_title(token) {
            Some(member) => vec![member.id.clone()],
            None => {
                let names = room
                    .active_members()
                    .map(|member| member.title.as_str())
                    .collect::<Vec<_>>()
                    .join("、");
                return Err(belfry_i18n::lformat!(
                    "房间里没有「{}」。可以写的收件人：@统筹、@全体、@成员、@用户，或角色名（{names}）",
                    token.trim()
                ));
            }
        },
    })
}

/// 正文里的 `@点名`。长名字先匹配并遮住短名（`@前端 2` 不会再点到 `@前端`）；
/// `@` 名字后面紧跟字母或汉字时算词的一部分（`@审查员` 不点 `审查`）。
pub fn mentions_in(room: &Room, text: &str) -> Vec<String> {
    let mut needles: Vec<String> = room
        .active_members()
        .map(|member| format!("@{}", member.title))
        .chain(["@全体", "@all", "@统筹", "@foreman", "@coordinator", "@成员", "@peers", "@members", "@用户", "@user"].map(String::from))
        .collect();
    needles.sort_by_key(|needle| std::cmp::Reverse(needle.chars().count()));
    let mut taken: Vec<(usize, usize)> = Vec::new();
    let mut hits: Vec<(usize, String)> = Vec::new();
    for needle in needles {
        let mut from = 0;
        while let Some(offset) = text[from..].find(&needle) {
            let start = from + offset;
            let end = start + needle.len();
            let bounded = text[end..].chars().next().is_none_or(|ch| !ch.is_alphanumeric());
            let shadowed = taken.iter().any(|(a, b)| start < *b && *a < end);
            if bounded && !shadowed {
                taken.push((start, end));
                hits.push((start, needle.clone()));
                break;
            }
            from = end;
        }
    }
    hits.sort_by_key(|(start, _)| *start);
    hits.into_iter().map(|(_, needle)| needle).collect()
}

/// 解析一条消息的收件人。规则照 CCCS §5：
/// - 一条消息只发给一个受众：要么只发给用户，要么只发给成员；混在一起就拒绝；
/// - 不写收件人时先看正文里的 `@点名`，再退到默认收件人；
/// - 发件人自己永远不在收件人里。
pub fn resolve_recipients(
    room: &Room,
    sender: &Actor,
    tokens: &[String],
    text: &str,
) -> Result<Vec<String>, String> {
    let explicit: Vec<String> = tokens
        .iter()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .collect();
    let tokens = if explicit.is_empty() { mentions_in(room, text) } else { explicit };
    let mut out: Vec<String> = Vec::new();
    if tokens.is_empty() {
        out = default_recipients(room, sender);
    } else {
        for token in &tokens {
            for id in expand_token(room, sender, token)? {
                if !out.contains(&id) {
                    out.push(id);
                }
            }
        }
    }
    out.retain(|id| id != sender.id());
    if matches!(sender, Actor::User) {
        out.retain(|id| id != "user");
    }
    if out.iter().any(|id| id == "user") && out.iter().any(|id| id != "user") {
        return Err(belfry_i18n::text("发给用户和发给成员要分成两条消息").to_string());
    }
    if out.is_empty() {
        return Err(belfry_i18n::text("这条消息没有可以收的人（房间里还没有别的成员？）").to_string());
    }
    Ok(out)
}

/// 能不能建一条派给 `assignee` 的任务。成员只能派给自己或统筹（CCCC：成员不能给别的成员派活）。
pub fn may_assign(room: &Room, actor: &Actor, assignee: Option<&str>) -> Result<(), String> {
    if actor.coordinates() {
        return Ok(());
    }
    match assignee {
        None => Ok(()),
        Some(id) if id == actor.id() => Ok(()),
        Some(id) if room.foreman().is_some_and(|foreman| foreman.id == id) => Ok(()),
        Some(_) => Err(belfry_i18n::text("成员不能给别的成员派活；需要别人做的，跟统筹说").to_string()),
    }
}

/// 能不能推进这条任务：负责人、统筹、用户；没人接的任务成员可以认领。
pub fn may_work_on(actor: &Actor, task: &Task) -> Result<(), String> {
    if actor.coordinates() {
        return Ok(());
    }
    match &task.assignee {
        Some(id) if id == actor.id() => Ok(()),
        None => Ok(()),
        Some(_) => Err(belfry_i18n::lformat!("{} 不是你负责的；要换人跟统筹说", task.id)),
    }
}

/// 一位成员手上没完成的任务数。
pub fn workload(room: &Room, member_id: &str) -> usize {
    room.tasks
        .iter()
        .filter(|task| {
            task.assignee.as_deref() == Some(member_id) && matches!(task.status, TaskStatus::Planned | TaskStatus::Active)
        })
        .count()
}

/// 还没完成的前置任务。
pub fn open_blockers(room: &Room, task: &Task) -> Vec<String> {
    task.blocked_by
        .iter()
        .filter(|id| {
            room.tasks
                .iter()
                .find(|candidate| &candidate.id == *id)
                .is_some_and(|candidate| !matches!(candidate.status, TaskStatus::Done | TaskStatus::Archived))
        })
        .cloned()
        .collect()
}

/// 状态迁移是否合法。归档与重开属于协调权。
pub fn check_move(actor: &Actor, from: TaskStatus, to: TaskStatus) -> Result<(), String> {
    use TaskStatus::*;
    match (from, to) {
        (a, b) if a == b => Err(belfry_i18n::lformat!("已经是「{}」了", a.label())),
        (Planned, Active) | (Planned, Done) | (Active, Done) | (Active, Planned) => Ok(()),
        (_, Archived) | (Done, Active) | (Done, Planned) | (Archived, _) if actor.coordinates() => Ok(()),
        (_, Archived) => Err(belfry_i18n::text("只有统筹或用户能归档任务").to_string()),
        (Done, _) => Err(belfry_i18n::text("已完成的任务只有统筹或用户能重开").to_string()),
        (Archived, _) => Err(belfry_i18n::text("已归档的任务只有统筹或用户能恢复").to_string()),
        _ => Err(belfry_i18n::text("这一步走不通").to_string()),
    }
}
