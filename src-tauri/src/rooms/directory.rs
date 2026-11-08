//! 成员经 `belfry room …` 进来的入口：把 CLI 命令翻成房间动作，再把结果翻回 CLI 的回答。

use std::sync::Arc;

use belfry_protocol::{
    Command, ResponseData, RoomBrief, RoomBriefView, RoomLine, RoomMemberLine, RoomStatusView,
    RoomTaskLine, RoomTaskOp,
};

use super::attachments;
use super::model::*;
use super::ops;
use super::store::{deliveries, RoomStore};
use crate::collab::{RoomDirectory, RoomPost, SessionRegistry};

pub struct MemberDirectory {
    pub store: Arc<RoomStore>,
    pub registry: Arc<SessionRegistry>,
}

/// 成员一分钟最多发几条消息。防的是成员之间互相接话打转——那是这套机制里唯一能自己跑下去的环。
const SAY_PER_MINUTE: usize = 12;

fn say_rate_guard(room_id: &str, member_id: &str, now: i64) -> Result<(), String> {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    /// (房间, 成员) → 最近一分钟内的发言时刻。
    type Recent = HashMap<(String, String), Vec<i64>>;
    static RECENT: OnceLock<Mutex<Recent>> = OnceLock::new();
    let mut guard = RECENT
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| belfry_i18n::text("发言记录锁不上，请重启应用后重试").to_string())?;
    let stamps = guard.entry((room_id.to_string(), member_id.to_string())).or_default();
    stamps.retain(|at| now - *at < 60_000);
    if stamps.len() >= SAY_PER_MINUTE {
        return Err(belfry_i18n::lformat!("说太快了：一分钟最多 {SAY_PER_MINUTE} 条，先把手上的活推进一下"));
    }
    stamps.push(now);
    Ok(())
}

pub fn task_line(room: &Room, task: &Task) -> RoomTaskLine {
    RoomTaskLine {
        id: task.id.clone(),
        title: task.title.clone(),
        status: task.status.label().to_string(),
        assignee: task.assignee.as_ref().map(|id| room.label(id)),
        outcome: task.outcome.clone(),
        waiting_for: open_blockers(room, task),
        notes: task.notes.clone(),
        result: task.result.clone(),
    }
}

fn brief_view(room: &Room) -> RoomBriefView {
    RoomBriefView {
        objective: room.brief.objective.clone(),
        focus: room.brief.current_focus.clone(),
        constraints: room.brief.constraints.clone(),
    }
}

fn line(room: &Room, message: &Message, viewer: &str) -> RoomLine {
    RoomLine {
        id: short_id(&message.id),
        author: room.label(&message.by),
        to: message.to.iter().map(|id| room.label(id)).collect(),
        // 成员读 log 要看得到附件在哪：正文后面附上本地路径。
        text: attachments::instruction(&message.text, &message.attachments),
        at: message.at,
        reply_preview: message.reply_to.as_ref().and_then(|id| room.message(id)).map(|original| {
            belfry_i18n::lformat!(
                "回复 [{}] {}：「{}」",
                short_id(&original.id),
                room.label(&original.by),
                excerpt(&attachments::summary(&original.text, &original.attachments), 60)
            )
        }),
        needs_my_reply: message.awaiting().iter().any(|id| id == viewer),
    }
}

fn open_count(room: &Room) -> usize {
    room.tasks
        .iter()
        .filter(|task| matches!(task.status, TaskStatus::Planned | TaskStatus::Active))
        .count()
}

impl MemberDirectory {
    fn status(&self, room: &Room, me: &Member) -> RoomStatusView {
        let activity = |tab_id: &str| {
            self.registry
                .find(tab_id)
                .map(|session| session.activity)
                .unwrap_or_else(|| "offline".to_string())
        };
        RoomStatusView {
            room: room.name.clone(),
            my_title: me.title.clone(),
            i_am_foreman: me.role == MemberRole::Foreman,
            brief: brief_view(room),
            members: room
                .active_members()
                .map(|member| RoomMemberLine {
                    title: member.title.clone(),
                    role: match member.role {
                        MemberRole::Foreman => belfry_i18n::text("统筹"),
                        MemberRole::Peer => belfry_i18n::text("成员"),
                    }
                    .to_string(),
                    duty: member.duty.clone(),
                    is_me: member.id == me.id,
                    activity: activity(&member.tab_id),
                })
                .collect(),
            tasks: room
                .tasks
                .iter()
                .filter(|task| task.status != TaskStatus::Archived)
                .map(|task| task_line(room, task))
                .collect(),
            awaiting_me: room
                .all_messages()
                .filter(|message| message.awaiting().contains(&me.id))
                .map(|message| line(room, message, &me.id))
                .collect(),
        }
    }

    fn task(&self, tab_id: &str, hint: Option<&str>, op: &RoomTaskOp) -> Result<(ResponseData, Vec<RoomPost>), String> {
        let now = now_millis();
        let ((task_id, posted), room) = self
            .store
            .mutate_as_member(tab_id, hint, |room, me| super::commands::apply_task_op(room, &Actor::Member(me), op, now))?;
        let index = room.task_index(&task_id).ok_or(belfry_i18n::text("任务刚改完就找不到了"))?;
        let notified: Vec<String> = posted
            .iter()
            .flat_map(|item| item.to.iter())
            .map(|id| room.label(id))
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        let note = if notified.is_empty() {
            belfry_i18n::text("已记在任务板上。").to_string()
        } else {
            belfry_i18n::lformat!("已通知：{}。", notified.join("、"))
        };
        Ok((
            ResponseData::RoomTaskChanged { room: room.name.clone(), task: task_line(&room, &room.tasks[index]), note },
            deliveries(&room, &posted),
        ))
    }
}

impl RoomDirectory for MemberDirectory {
    fn enqueue_posts(&self, board: &crate::collab::TaskBoard, registry: &SessionRegistry, posts: &[RoomPost]) -> Result<(), String> {
        self.store.enqueue_posts(board, registry, posts).map_err(|error| error.message)
    }

    fn handle(&self, tab_id: &str, command: &Command) -> Result<(ResponseData, Vec<RoomPost>), String> {
        match command {
            Command::Rooms => {
                let rooms = self
                    .store
                    .my_rooms(tab_id)
                    .iter()
                    .filter_map(|room| {
                        let me = room.member_by_tab(tab_id)?;
                        Some(RoomBrief {
                            name: room.name.clone(),
                            my_title: me.title.clone(),
                            my_duty: me.duty.clone(),
                            i_am_foreman: me.role == MemberRole::Foreman,
                            foreman: room.foreman().map(|member| member.title.clone()),
                            objective: room.brief.objective.clone(),
                            open_tasks: open_count(room),
                            awaiting_me: room.messages.iter().filter(|m| m.awaiting().contains(&me.id)).count(),
                        })
                    })
                    .collect();
                Ok((ResponseData::Rooms { rooms }, Vec::new()))
            }
            Command::RoomStatus { room } => {
                let status = self.store.read_as_member(tab_id, room.as_deref(), |room, me| self.status(room, me))?;
                Ok((ResponseData::RoomStatus { status }, Vec::new()))
            }
            Command::RoomLog { room, count } => {
                let count = count.unwrap_or(20).clamp(1, 50) as usize;
                self.store.read_as_member(tab_id, room.as_deref(), |room, me| {
                    let start = room.messages.len().saturating_sub(count);
                    let entries = room.messages[start..].iter().map(|message| line(room, message, &me.id)).collect();
                    (ResponseData::RoomLog { room: room.name.clone(), entries }, Vec::new())
                })
            }
            Command::RoomSay { room, text, reply_to, to, ask } => {
                let now = now_millis();
                let (posted, room) = self.store.mutate_as_member(tab_id, room.as_deref(), |room, me| {
                    say_rate_guard(&room.id, &me.id, now)?;
                    ops::say(room, &Actor::Member(me), to, text, reply_to.as_deref(), *ask, now)
                })?;
                let posts = deliveries(&room, std::slice::from_ref(&posted));
                let mut skipped: Vec<String> = posts
                    .iter()
                    .filter(|post| self.registry.find(&post.tab_id).is_none())
                    .map(|post| belfry_i18n::lformat!("「{}」的会话已经不在了，消息只记在房间里", post.member_title))
                    .collect();
                if room.paused {
                    skipped.push(belfry_i18n::text("房间暂停中：消息只记在房间里，暂不送进成员终端").to_string());
                }
                Ok((
                    ResponseData::RoomSaid {
                        room: room.name.clone(),
                        message: short_id(&posted.message_id),
                        recipients: posted.to.iter().map(|id| room.label(id)).collect(),
                        skipped,
                        ask: *ask,
                    },
                    posts,
                ))
            }
            Command::RoomTask { room, op } => self.task(tab_id, room.as_deref(), op),
            Command::RoomBrief { room, objective, focus, constraints } => {
                let now = now_millis();
                let (posted, room) = self.store.mutate_as_member(tab_id, room.as_deref(), |room, me| {
                    ops::update_brief(room, &Actor::Member(me), objective.as_deref(), focus.as_deref(), constraints.clone(), now)
                })?;
                Ok((
                    ResponseData::RoomBriefUpdated { room: room.name.clone(), brief: brief_view(&room) },
                    deliveries(&room, std::slice::from_ref(&posted)),
                ))
            }
            _ => Err(belfry_i18n::text("这不是房间命令").to_string()),
        }
    }
}
