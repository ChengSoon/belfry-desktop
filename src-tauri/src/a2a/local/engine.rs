use belfry_protocol::inbox::{AgentCommand, EntryVersion, MessageOptions, TaskRef};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

use super::{Service, State, id, local_error, lock_error, types::*};
use crate::{
    collab::task::{self, ApprovalMode, CollabTask, TargetInfo, TaskRequest, TaskState, Verdict},
    plugins::agent_connection::AuthorizedAgent,
    rooms::{
        self,
        model::{Actor, Room, TaskStatus},
    },
    terminal::AppError,
};

const TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_HISTORY_BYTES: usize = 512 * 1024;
/// Keep list responses below the embedded Node bridge message limit. A model
/// can read a single task for the complete history/artifacts.
const MAX_LIST_BYTES: usize = 700 * 1024;

pub(super) fn signature(value: &Value) -> String {
    format!("{:x}", Sha256::digest(value.to_string().as_bytes()))
}
fn changed() -> AppError {
    local_error(
        "A2A_LOCAL_TASK_CHANGED",
        "This task assignment or agent instance changed. Read the current task context.",
    )
}
fn missing() -> AppError {
    local_error(
        "A2A_LOCAL_TASK_NOT_FOUND",
        "No local protocol task exists in your current role scope.",
    )
}
fn business(message: String) -> AppError {
    local_error("A2A_LOCAL_PERMISSION_OR_STATE", &message)
}
fn prune(state: &mut State) {
    state.tasks.retain(|_, link| link.used.elapsed() < TTL);
    state.replay.retain(|_, replay| {
        replay.used.elapsed() < TTL && state.tasks.contains_key(&replay.task_id)
    });
}
fn capacity(state: &mut State, owner: &AuthorizedAgent) -> Result<(), AppError> {
    prune(state);
    if state.tasks.len() >= 1024
        || state
            .tasks
            .values()
            .filter(|link| link.recipient == *owner)
            .count()
            >= 128
        || state.replay.len() >= 4096
    {
        return Err(local_error(
            "A2A_LOCAL_TASK_LIMIT",
            "The local protocol task or operation limit was reached.",
        ));
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RecipientHealth {
    Active,
    Gone,
    Unknown,
}

/// One point-in-time view for list/snapshot work. Previously every task and
/// every inbox message re-queried the daemon for authorized agents and cloned
/// the whole task board; one snapshot per call keeps polling bounded.
pub(super) struct Snapshots {
    current: Option<Vec<AuthorizedAgent>>,
    tasks: Option<HashMap<String, CollabTask>>,
    rooms: HashMap<String, Option<Room>>,
}
impl Snapshots {
    pub(super) fn load(service: &Service) -> Self {
        Self {
            current: service.access.snapshot().ok(),
            tasks: None,
            rooms: HashMap::new(),
        }
    }
    pub(super) fn load_required(service: &Service) -> Result<Self, AppError> {
        Ok(Self {
            current: Some(service.access.snapshot()?),
            tasks: None,
            rooms: HashMap::new(),
        })
    }
    pub(super) fn contains(&self, owner: &AuthorizedAgent) -> bool {
        self.current
            .as_deref()
            .is_some_and(|current| current.iter().any(|agent| agent == owner))
    }
    fn members(&self) -> Option<&[AuthorizedAgent]> {
        self.current.as_deref()
    }
    /// The board is cloned at most once per call, and only when a direct task
    /// actually needs it. Room-only polls do not pay for the whole board.
    pub(super) fn tasks(&mut self, service: &Service) -> &HashMap<String, CollabTask> {
        self.tasks.get_or_insert_with(|| {
            service
                .board
                .snapshot()
                .into_iter()
                .map(|task| (task.id.clone(), task))
                .collect()
        })
    }
    pub(super) fn has_reference(
        &mut self,
        service: &Service,
        reference: &TaskRef,
        root: &str,
    ) -> bool {
        if let Some(room_id) = &reference.room_id {
            self.room(service, room_id).is_some_and(|room| {
                crate::collab::inbox::normalize_root(&room.project_root)
                    == crate::collab::inbox::normalize_root(root)
                    && room.tasks.iter().any(|task| {
                        task.id == reference.id && task.generation == reference.generation
                    })
            })
        } else {
            self.tasks(service).get(&reference.id).is_some_and(|task| {
                task.project_root.as_deref().is_some_and(|project| {
                    crate::collab::inbox::normalize_root(project)
                        == crate::collab::inbox::normalize_root(root)
                })
            })
        }
    }
    fn task(&mut self, service: &Service, link: &Link) -> Option<&CollabTask> {
        self.tasks(service).get(&link.reference.id).filter(|task| {
            task.to == link.recipient.tab_id
                && task.project_root.as_deref() == Some(&link.recipient.root)
        })
    }
    fn room(&mut self, service: &Service, id: &str) -> Option<Room> {
        self.rooms
            .entry(id.to_owned())
            .or_insert_with(|| service.rooms.get(id).ok())
            .clone()
    }
}
fn push_history(link: &mut Link, message: Value) {
    link.history.push(message);
    while link.history.len() > 20
        || link
            .history
            .iter()
            .map(|v| v.to_string().len())
            .sum::<usize>()
            > MAX_HISTORY_BYTES
    {
        link.history.remove(0);
    }
}
fn topic(reference: &TaskRef) -> String {
    match &reference.room_id {
        Some(room) => format!("room:{room}:task:{}:{}", reference.id, reference.generation),
        None => format!("direct:{}", reference.id),
    }
}

impl Service {
    /// Accepts exactly one protocol message under a durable business authority.
    /// Waiting for an explicit result is implemented by HTTP after this returns.
    pub(super) fn send(
        &self,
        owner: &AuthorizedAgent,
        target_id: &str,
        message: Value,
        context: Option<RoomContext>,
    ) -> Result<Link, AppError> {
        self.current(owner)?;
        let target = self.target(owner, target_id)?;
        let _operation = self.operations.lock().map_err(|_| lock_error())?;
        let message_id = message["messageId"].as_str().ok_or_else(missing)?;
        let replay_key = format!("send:{}:{message_id}", owner.ticket);
        let digest = signature(&message);
        {
            let mut state = self.state.lock().map_err(|_| lock_error())?;
            prune(&mut state);
            if let Some(replay) = state.replay.get(&replay_key) {
                if replay.signature != digest {
                    return Err(local_error(
                        "A2A_LOCAL_OPERATION_CONFLICT",
                        "A message ID was reused with different content.",
                    ));
                }
                let link = state
                    .tasks
                    .get(&replay.task_id)
                    .filter(|link| {
                        link.sender.as_ref() == Some(owner) && link.target_id == target_id
                    })
                    .cloned()
                    .ok_or_else(missing)?;
                self.role_scope(owner, &link)?;
                return Ok(link);
            }
            if state.replay.len() >= 4096 {
                return Err(local_error(
                    "A2A_LOCAL_TASK_LIMIT",
                    "The local protocol task or operation limit was reached.",
                ));
            }
        }
        let text = message["parts"]
            .as_array()
            .ok_or_else(missing)?
            .iter()
            .map(|part| part["text"].as_str().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n");
        let link = if let Some(task_id) = message.get("taskId").and_then(Value::as_str) {
            let mut link = self.owned_link(owner, target_id, task_id)?;
            if context.is_some()
                || self.authority(&link)?.0.terminal()
                || message
                    .get("contextId")
                    .and_then(Value::as_str)
                    .is_some_and(|id| id != link.context_id)
            {
                return Err(changed());
            }
            self.valid_reference(&link)?;
            self.continuation(owner, &link, &text, message_id)?;
            link.progress = Progress::Working;
            link.status_text = None;
            link.question_ids.clear();
            push_history(&mut link, message.clone());
            link.used = Instant::now();
            link
        } else {
            let mut state = self.state.lock().map_err(|_| lock_error())?;
            capacity(&mut state, &target.owner)?;
            drop(state);
            let context_id =
                if let Some(requested) = message.get("contextId").and_then(Value::as_str) {
                    let state = self.state.lock().map_err(|_| lock_error())?;
                    if !state.tasks.values().any(|link| {
                        link.context_id == requested
                            && link.sender.as_ref() == Some(owner)
                            && link.target_id == target_id
                    }) {
                        return Err(local_error(
                            "A2A_LOCAL_CONTEXT_NOT_FOUND",
                            "A new task may only reuse one of your existing target contexts.",
                        ));
                    }
                    requested.to_owned()
                } else {
                    id()
                };
            let context = self.room_context(owner, &target.owner, context, &text)?;
            let (reference, room_name) = match context {
                Some(context) => self.create_room_task(owner, &target.owner, &context, &text)?,
                None => (self.create_direct_task(owner, &target.owner, &text)?, None),
            };
            let task_id = id();
            Link {
                id: task_id,
                context_id,
                sender: Some(owner.clone()),
                recipient: target.owner,
                target_id: target_id.into(),
                reference,
                report_handle: id(),
                instruction: text,
                progress: Progress::Submitted,
                status_text: None,
                artifacts: vec![],
                history: vec![message.clone()],
                question_ids: vec![],
                room_name,
                used: Instant::now(),
            }
        };
        self.current(owner)?;
        let mut state = self.state.lock().map_err(|_| lock_error())?;
        state.replay.insert(
            replay_key,
            Replay {
                signature: digest,
                task_id: link.id.clone(),
                used: Instant::now(),
            },
        );
        state.tasks.insert(link.id.clone(), link.clone());
        drop(state);
        self.links.save(&link);
        Ok(link)
    }

    fn room_context(
        &self,
        sender: &AuthorizedAgent,
        recipient: &AuthorizedAgent,
        requested: Option<RoomContext>,
        text: &str,
    ) -> Result<Option<RoomContext>, AppError> {
        if let Some(context) = requested {
            self.rooms
                .read_as_member(&sender.tab_id, Some(&context.room), |room, _| room.clone())
                .map_err(business)?;
            return Ok(Some(context));
        }
        let common = self
            .rooms
            .my_rooms(&sender.tab_id)
            .into_iter()
            .filter(|room| {
                room.member_by_tab(&recipient.tab_id).is_some()
                    && crate::collab::inbox::normalize_root(&room.project_root) == sender.root
            })
            .collect::<Vec<_>>();
        match common.len() {
            0 => Ok(None),
            1 => {
                // Assigning another member is a coordinator action. A plain member
                // must not lose peer-to-peer work just because the two agents happen
                // to share a room: fall back to a direct task instead of letting the
                // room taskboard reject the assignment.
                let room = &common[0];
                let Some(sender_member) = room.member_by_tab(&sender.tab_id) else {
                    return Ok(None);
                };
                let Some(recipient_member) = room.member_by_tab(&recipient.tab_id) else {
                    return Ok(None);
                };
                if rooms::model::may_assign(
                    room,
                    &Actor::Member(sender_member),
                    Some(&recipient_member.id),
                )
                .is_err()
                {
                    return Ok(None);
                }
                let title = text.trim();
                let title: String = title
                    .chars()
                    .take(rooms::ops::MAX_TASK_TITLE_CHARS)
                    .collect();
                Ok(Some(RoomContext {
                    room: room.id.clone(),
                    title,
                    after: vec![],
                }))
            }
            _ => Err(local_error(
                "A2A_LOCAL_ROOM_AMBIGUOUS",
                "These agents share multiple rooms. Use the room task tool to choose the authorized room.",
            )),
        }
    }

    fn create_direct_task(
        &self,
        sender: &AuthorizedAgent,
        recipient: &AuthorizedAgent,
        text: &str,
    ) -> Result<TaskRef, AppError> {
        // A nested sender can only inherit its own live, registered assignment.
        let owned = self
            .state
            .lock()
            .map_err(|_| lock_error())?
            .tasks
            .values()
            .filter(|link| {
                link.recipient == *sender
                    && link.reference.kind == "direct_task"
                    && !link.progress.terminal()
            })
            .map(|link| link.reference.id.clone())
            .collect::<Vec<_>>();
        let parent = self
            .board
            .snapshot()
            .into_iter()
            .filter(|task| owned.contains(&task.id) && !task::is_settled(&task.state))
            .max_by_key(|task| task.created_at);
        let request = TaskRequest {
            from: &sender.tab_id,
            to: &recipient.tab_id,
            instruction: text,
            parent: parent.as_ref(),
        };
        let root = parent
            .as_ref()
            .and_then(|p| p.path.first())
            .unwrap_or(&sender.tab_id);
        let verdict = task::judge(
            &request,
            &TargetInfo {
                exists: true,
                can_receive: true,
                same_project: sender.root == recipient.root,
            },
            ApprovalMode::AutoInProject,
            self.board.count_in_path(root),
        );
        if let Verdict::Rejected(message) = &verdict {
            return Err(business(message.clone()));
        }
        let key = id();
        let mut task =
            task::build_task(key.clone(), &request, rooms::model::now_millis(), &verdict);
        task.project_root = Some(recipient.root.clone());
        self.board.insert(task).map_err(business)?;
        Ok(TaskRef {
            kind: "direct_task".into(),
            room_id: None,
            id: key,
            generation: 1,
        })
    }

    fn create_room_task(
        &self,
        sender: &AuthorizedAgent,
        recipient: &AuthorizedAgent,
        context: &RoomContext,
        text: &str,
    ) -> Result<(TaskRef, Option<String>), AppError> {
        let ((key, posts), room) = self
            .rooms
            .mutate_as_member(&sender.tab_id, Some(&context.room), |room, member| {
                if crate::collab::inbox::normalize_root(&room.project_root) != sender.root
                    || recipient.root != sender.root
                {
                    return Err("Room project scope changed.".into());
                }
                let target = room
                    .member_by_tab(&recipient.tab_id)
                    .ok_or("The recipient is not an active member of this room.")?
                    .title
                    .clone();
                rooms::ops::task_add(
                    room,
                    &Actor::Member(member),
                    &context.title,
                    Some(text),
                    Some(&target),
                    &context.after,
                    rooms::model::now_millis(),
                )
            })
            .map_err(business)?;
        self.enqueue(&room, &posts);
        let task = &room.tasks[room.task_index(&key).ok_or_else(changed)?];
        Ok((
            TaskRef {
                kind: "room_task".into(),
                room_id: Some(room.id.clone()),
                id: key,
                generation: task.generation,
            },
            Some(room.name),
        ))
    }

    fn enqueue(&self, room: &Room, posted: &[rooms::ops::Posted]) {
        let posts = rooms::store_deliveries(room, posted);
        if let Err(_) = self
            .rooms
            .enqueue_posts(&self.board, &self.registry, &posts)
        {
            // Source content is already durable. Retain the outbox for its regular
            // pump rather than reporting a completed or certainly delivered task.
            log::warn!("Local A2A room delivery retained in the durable outbox");
        }
    }

    fn continuation(
        &self,
        owner: &AuthorizedAgent,
        link: &Link,
        text: &str,
        message_id: &str,
    ) -> Result<(), AppError> {
        if let Some(room_id) = &link.reference.room_id {
            let (posted, room) = self
                .rooms
                .mutate_as_member(&owner.tab_id, Some(room_id), |room, member| {
                    check_room_reference(room, link)?;
                    let target = room
                        .member_by_tab(&link.recipient.tab_id)
                        .ok_or("The recipient left the room.")?
                        .title
                        .clone();
                    rooms::semantics::say(
                        room,
                        &Actor::Member(member),
                        &[target],
                        text,
                        None,
                        false,
                        &MessageOptions {
                            topic_id: Some(topic(&link.reference)),
                            answers: link.question_ids.clone(),
                            operation_id: Some(message_id.into()),
                            ..Default::default()
                        },
                        rooms::model::now_millis(),
                    )
                })
                .map_err(business)?;
            self.enqueue(&room, &posted);
        } else {
            self.board
                .protocol_message(
                    &link.reference.id,
                    &owner.tab_id,
                    &link.recipient.tab_id,
                    text,
                    false,
                    &link.question_ids,
                )
                .map_err(business)?;
        }
        Ok(())
    }

    fn role_scope(&self, owner: &AuthorizedAgent, link: &Link) -> Result<(), AppError> {
        if owner.root != link.recipient.root {
            return Err(missing());
        }
        if let Some(room) = &link.reference.room_id {
            self.rooms
                .read_as_member(&owner.tab_id, Some(room), |_, _| ())
                .map_err(|_| missing())?;
        }
        Ok(())
    }
    pub(super) fn owned_link(
        &self,
        owner: &AuthorizedAgent,
        target_id: &str,
        key: &str,
    ) -> Result<Link, AppError> {
        self.current(owner)?;
        let mut state = self.state.lock().map_err(|_| lock_error())?;
        prune(&mut state);
        let link = state
            .tasks
            .get_mut(key)
            .filter(|link| link.sender.as_ref() == Some(owner) && link.target_id == target_id)
            .ok_or_else(missing)?;
        link.used = Instant::now();
        let link = link.clone();
        drop(state);
        self.role_scope(owner, &link)?;
        Ok(link)
    }
    fn valid_reference(&self, link: &Link) -> Result<(), AppError> {
        let mut snapshots = Snapshots::load(self);
        self.valid_reference_with(link, &mut snapshots)
    }
    fn valid_reference_with(&self, link: &Link, snapshots: &mut Snapshots) -> Result<(), AppError> {
        if !matches!(
            self.recipient_health(&link.recipient, snapshots.members()),
            RecipientHealth::Active
        ) {
            return Err(changed());
        }
        if let Some(room_id) = &link.reference.room_id {
            let room = snapshots.room(self, room_id).ok_or_else(changed)?;
            check_room_reference(&room, link).map_err(|_| changed())?;
        } else {
            let task = snapshots.task(self, link).ok_or_else(changed)?;
            if matches!(task.state, TaskState::Abandoned) {
                return Err(changed());
            }
        }
        Ok(())
    }

    fn recipient_health(
        &self,
        owner: &AuthorizedAgent,
        current: Option<&[AuthorizedAgent]>,
    ) -> RecipientHealth {
        if self.stopped.load(Ordering::Acquire) || !self.registered(owner) {
            return RecipientHealth::Gone;
        }
        match current {
            Some(current) if current.iter().any(|agent| agent == owner) => RecipientHealth::Active,
            Some(_) => RecipientHealth::Gone,
            // The daemon snapshot itself failed. Do not turn a transient lookup
            // failure into a terminal FAILED for the sender.
            None => RecipientHealth::Unknown,
        }
    }

    fn authority(&self, link: &Link) -> Result<(Progress, Option<String>), AppError> {
        let mut snapshots = Snapshots::load(self);
        self.authority_with(link, &mut snapshots)
    }
    fn authority_with(
        &self,
        link: &Link,
        snapshots: &mut Snapshots,
    ) -> Result<(Progress, Option<String>), AppError> {
        let (status, result) = if let Some(room_id) = &link.reference.room_id {
            let room = snapshots.room(self, room_id).ok_or_else(changed)?;
            if check_room_reference(&room, link).is_err() {
                return Ok((Progress::Failed,Some("The room assignment lifecycle changed; this protocol task cannot settle its replacement.".into())));
            }
            let task = &room.tasks[room.task_index(&link.reference.id).ok_or_else(changed)?];
            (
                match task.status {
                    TaskStatus::Done => Progress::Completed,
                    TaskStatus::Archived => {
                        if link.progress == Progress::Completed {
                            Progress::Completed
                        } else {
                            Progress::Failed
                        }
                    }
                    TaskStatus::Active => Progress::Working,
                    TaskStatus::Planned => Progress::Submitted,
                },
                task.result.clone(),
            )
        } else {
            let task = snapshots.task(self, link).ok_or_else(changed)?;
            (
                match task.state {
                    TaskState::Done => Progress::Completed,
                    TaskState::Failed => Progress::Failed,
                    TaskState::Abandoned => {
                        if link.progress == Progress::Canceled {
                            Progress::Canceled
                        } else {
                            Progress::Failed
                        }
                    }
                    TaskState::Dispatched => Progress::Working,
                    _ => Progress::Submitted,
                },
                task.result.clone(),
            )
        };
        if status.terminal() {
            return Ok((status, result.or_else(|| link.status_text.clone())));
        }
        if link.progress.terminal() {
            return Ok((link.progress, link.status_text.clone()));
        }
        match self.recipient_health(&link.recipient, snapshots.members()) {
            RecipientHealth::Active => {}
            RecipientHealth::Gone => {
                return Ok((Progress::Failed,Some("The recipient instance ended without an explicit result; the business task remains unresolved.".into())));
            }
            RecipientHealth::Unknown => {
                return Ok((status,Some("The recipient's session state could not be verified; the business task remains active.".into())));
            }
        }
        Ok((
            if matches!(link.progress, Progress::Working | Progress::InputRequired) {
                link.progress
            } else {
                status
            },
            link.status_text.clone(),
        ))
    }
    pub(super) fn task_value(&self, link: &Link, history_length: u32) -> Result<Value, AppError> {
        let mut snapshots = Snapshots::load(self);
        self.task_value_with(link, history_length, &mut snapshots)
    }
    pub(super) fn task_value_with(
        &self,
        link: &Link,
        history_length: u32,
        snapshots: &mut Snapshots,
    ) -> Result<Value, AppError> {
        let (progress, text) = self.authority_with(link, snapshots)?;
        let mut task = json!({"id":link.id,"contextId":link.context_id,"status":{"state":progress.wire()},
            "metadata":{"belfry":{"taskRef":link.reference}}});
        if let Some(text) = text {
            task["status"]["message"] = json!({"messageId":format!("status-{}",link.id),"role":"ROLE_AGENT",
            "taskId":link.id,"contextId":link.context_id,"parts":[{"text":text}]});
        }
        if !link.artifacts.is_empty() {
            task["artifacts"] = json!(link.artifacts);
        }
        if progress == Progress::Completed && link.artifacts.is_empty() {
            if let Some(text) = task["status"]["message"]["parts"][0]["text"].as_str() {
                task["artifacts"] =
                    json!([{"artifactId":format!("result-{}",link.id),"parts":[{"text":text}]}]);
            }
        }
        if history_length > 0 {
            let count = (history_length as usize).min(20).min(link.history.len());
            task["history"] = json!(&link.history[link.history.len() - count..]);
        }
        Ok(task)
    }
    fn descriptor(&self, link: &Link) -> Result<LocalTask, AppError> {
        let mut snapshots = Snapshots::load(self);
        self.descriptor_with(link, &mut snapshots, 20)
    }
    fn descriptor_with(
        &self,
        link: &Link,
        snapshots: &mut Snapshots,
        history_length: u32,
    ) -> Result<LocalTask, AppError> {
        let source = match &link.reference.room_id {
            Some(room) => {
                json!({"kind":"room","roomId":room,"roomName":link.room_name,"taskId":link.reference.id})
            }
            None => json!({"kind":"direct","taskId":link.reference.id}),
        };
        Ok(LocalTask {
            report_handle: link.report_handle.clone(),
            generation: link.reference.generation,
            task_ref: link.reference.clone(),
            task: self.task_value_with(link, history_length, snapshots)?,
            instruction: link.instruction.clone(),
            source,
        })
    }
    pub(super) fn report_task(
        &self,
        owner: &AuthorizedAgent,
        handle: &str,
    ) -> Result<LocalTask, AppError> {
        self.current(owner)?;
        let link = self.report_link(owner, handle)?;
        let mut snapshots = Snapshots::load_required(self)?;
        self.valid_reference_with(&link, &mut snapshots)?;
        self.descriptor_with(&link, &mut snapshots, 20)
    }
    fn report_link(&self, owner: &AuthorizedAgent, handle: &str) -> Result<Link, AppError> {
        let mut state = self.state.lock().map_err(|_| lock_error())?;
        prune(&mut state);
        let link = state
            .tasks
            .values_mut()
            .find(|link| link.report_handle == handle && link.recipient == *owner)
            .ok_or_else(missing)?;
        link.used = Instant::now();
        Ok(link.clone())
    }

    pub(super) fn report(
        &self,
        owner: &AuthorizedAgent,
        input: ReportInput,
        digest: &str,
    ) -> Result<LocalTask, AppError> {
        self.current(owner)?;
        crate::a2a::validation::request_id(&input.operation_id)?;
        let _operation = self.operations.lock().map_err(|_| lock_error())?;
        let mut link = self.report_link(owner, &input.report_handle)?;
        if link.reference.generation != input.generation {
            return Err(changed());
        }
        self.valid_reference(&link)?;
        let replay_key = format!("report:{}:{}", owner.ticket, input.operation_id);
        if let Some(replay) = self
            .state
            .lock()
            .map_err(|_| lock_error())?
            .replay
            .get(&replay_key)
            .cloned()
        {
            if replay.signature != digest || replay.task_id != link.id {
                return Err(local_error(
                    "A2A_LOCAL_OPERATION_CONFLICT",
                    "An operation ID was reused with different content.",
                ));
            }
            return self.descriptor(&link);
        }
        if self.state.lock().map_err(|_| lock_error())?.replay.len() >= 4096 {
            return Err(local_error(
                "A2A_LOCAL_TASK_LIMIT",
                "The local protocol task or operation limit was reached.",
            ));
        }
        if self.authority(&link)?.0.terminal() {
            return Err(changed());
        }
        validate_report(&input, &link)?;
        let text = input
            .text
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let result = input
            .artifacts
            .iter()
            .map(|a| match &a.name {
                Some(name) => format!("{name}\n{}", a.text),
                None => a.text.clone(),
            })
            .chain(text.map(str::to_owned))
            .collect::<Vec<_>>()
            .join("\n\n");
        let mut question_ids = vec![];
        if let Some(room_id) = &link.reference.room_id {
            let (posted, room) = self
                .rooms
                .mutate_as_member(&owner.tab_id, Some(room_id), |room, member| {
                    check_room_reference(room, &link)?;
                    let actor = Actor::Member(member);
                    let now = rooms::model::now_millis();
                    let mut posted = vec![];
                    match input.state {
                        ReportState::Completed => posted.extend(rooms::ops::task_done(
                            room,
                            &actor,
                            &link.reference.id,
                            Some(&result),
                            now,
                        )?),
                        ReportState::Working | ReportState::InputRequired => {
                            if room.tasks[room
                                .task_index(&link.reference.id)
                                .ok_or("Task no longer exists.")?]
                            .status
                                == TaskStatus::Planned
                            {
                                posted.extend(rooms::ops::task_start(
                                    room,
                                    &actor,
                                    &link.reference.id,
                                    now,
                                )?);
                            }
                            if let Some(text) = text {
                                rooms::ops::task_note(room, &actor, &link.reference.id, text, now)?;
                            }
                        }
                        ReportState::Failed => {
                            rooms::ops::task_note(
                                room,
                                &actor,
                                &link.reference.id,
                                &format!("A2A failed: {result}"),
                                now,
                            )?;
                        }
                    }
                    if matches!(
                        input.state,
                        ReportState::InputRequired | ReportState::Failed
                    ) {
                        let to = link
                            .sender
                            .as_ref()
                            .filter(|sender| sender.tab_id != owner.tab_id)
                            .and_then(|sender| room.member_by_tab(&sender.tab_id))
                            .map(|member| vec![member.title.clone()])
                            .unwrap_or_default();
                        let message = if matches!(input.state, ReportState::Failed) {
                            format!("A2A task {} failed: {result}", link.reference.id)
                        } else {
                            text.unwrap_or_default().into()
                        };
                        let options = MessageOptions {
                            topic_id: Some(topic(&link.reference)),
                            questions: if matches!(input.state, ReportState::InputRequired) {
                                vec![message.clone()]
                            } else {
                                vec![]
                            },
                            operation_id: Some(input.operation_id.clone()),
                            ..Default::default()
                        };
                        let notices = rooms::semantics::say(
                            room,
                            &actor,
                            &to,
                            &message,
                            None,
                            matches!(input.state, ReportState::InputRequired),
                            &options,
                            now,
                        )?;
                        for post in &notices {
                            if let Some(semantics) = room
                                .message(&post.message_id)
                                .and_then(|m| m.inbox.as_ref())
                            {
                                question_ids
                                    .extend(semantics.questions.iter().map(|q| q.id.clone()));
                            }
                        }
                        posted.extend(notices);
                    }
                    Ok(posted)
                })
                .map_err(business)?;
            self.enqueue(&room, &posted);
        } else {
            match input.state {
                ReportState::Completed => self
                    .board
                    .protocol_settle(
                        &link.reference.id,
                        &owner.tab_id,
                        &owner.root,
                        TaskState::Done,
                        result.clone(),
                    )
                    .map_err(business)?,
                ReportState::Failed => self
                    .board
                    .protocol_settle(
                        &link.reference.id,
                        &owner.tab_id,
                        &owner.root,
                        TaskState::Failed,
                        result.clone(),
                    )
                    .map_err(business)?,
                ReportState::InputRequired => {
                    if let Some(sender) = &link.sender {
                        question_ids.push(
                            self.board
                                .protocol_message(
                                    &link.reference.id,
                                    &owner.tab_id,
                                    &sender.tab_id,
                                    text.unwrap_or_default(),
                                    true,
                                    &[],
                                )
                                .map_err(business)?,
                        );
                    }
                }
                ReportState::Working => {}
            }
        }
        link.progress = match input.state {
            ReportState::Working => Progress::Working,
            ReportState::InputRequired => Progress::InputRequired,
            ReportState::Completed => Progress::Completed,
            ReportState::Failed => Progress::Failed,
        };
        link.status_text = text
            .map(str::to_owned)
            .or_else(|| (!result.is_empty()).then_some(result));
        for artifact in input.artifacts {
            let mut value = json!({"artifactId":id(),"parts":[{"text":artifact.text}]});
            if let Some(name) = artifact.name {
                value["name"] = json!(name);
            }
            link.artifacts.push(value);
        }
        let message = json!({"messageId":input.operation_id,"role":"ROLE_AGENT","taskId":link.id,"contextId":link.context_id,
            "parts":[{"text":link.status_text.as_deref().unwrap_or("Working")}] });
        push_history(&mut link, message);
        link.question_ids = question_ids.clone();
        link.used = Instant::now();
        self.current(owner)?;
        let mut state = self.state.lock().map_err(|_| lock_error())?;
        state.replay.insert(
            replay_key,
            Replay {
                signature: digest.into(),
                task_id: link.id.clone(),
                used: Instant::now(),
            },
        );
        state.tasks.insert(link.id.clone(), link.clone());
        drop(state);
        self.links.save(&link);
        if matches!(input.state, ReportState::InputRequired)
            && !question_ids.is_empty()
            && self.board.inbox_enabled()
        {
            if let Err(_) = self.inbox.agent(
                &owner.tab_id,
                &AgentCommand::Wait {
                    question_ids,
                    task: Some(link.reference.clone()),
                    clear: false,
                    operation_id: id(),
                },
            ) {
                log::warn!(
                    "Local A2A input request remains in its durable conversation; inbox wait could not be recorded"
                );
            }
        }
        self.descriptor(&link)
    }

    pub(super) fn cancel(
        &self,
        owner: &AuthorizedAgent,
        target_id: &str,
        key: &str,
    ) -> Result<Link, AppError> {
        self.current(owner)?;
        let _operation = self.operations.lock().map_err(|_| lock_error())?;
        let mut link = self.owned_link(owner, target_id, key)?;
        if link.progress == Progress::Canceled {
            return Ok(link);
        }
        if link.reference.room_id.is_some() || self.authority(&link)?.0 != Progress::Submitted {
            return Err(not_cancelable());
        }
        self.valid_reference(&link)?;
        if self.board.inbox_enabled() {
            let value = self
                .inbox
                .agent(
                    &owner.tab_id,
                    &AgentCommand::Read {
                        message_id: link.reference.id.clone(),
                        cursor: None,
                        limit: Some(30),
                    },
                )
                .map_err(|_| not_cancelable())?;
            let belfry_protocol::ResponseData::CollaborationInbox { result } = value else {
                return Err(not_cancelable());
            };
            let entries = result["messages"]
                .as_array()
                .ok_or_else(not_cancelable)?
                .iter()
                .filter(|entry| entry["recipient"]["tabId"] == link.recipient.tab_id)
                .map(|entry| {
                    Ok(EntryVersion {
                        id: entry["id"].as_str().ok_or_else(not_cancelable)?.into(),
                        revision: entry["revision"].as_u64().ok_or_else(not_cancelable)?,
                    })
                })
                .collect::<Result<Vec<_>, AppError>>()?;
            if entries.is_empty() {
                return Err(not_cancelable());
            }
            self.inbox
                .agent(
                    &owner.tab_id,
                    &AgentCommand::Withdraw {
                        entries,
                        operation_id: id(),
                    },
                )
                .map_err(|_| not_cancelable())?;
            if !self
                .board
                .snapshot()
                .iter()
                .any(|task| task.id == link.reference.id && task.state == TaskState::Abandoned)
            {
                return Err(not_cancelable());
            }
        } else {
            self.board
                .protocol_cancel_queued(&link.reference.id, &owner.tab_id, &owner.root)
                .map_err(|_| not_cancelable())?;
        }
        link.progress = Progress::Canceled;
        link.status_text=Some("The queued task was withdrawn before a submission intent; no running process was stopped.".into());
        self.state
            .lock()
            .map_err(|_| lock_error())?
            .tasks
            .insert(link.id.clone(), link.clone());
        self.links.save(&link);
        Ok(link)
    }

    pub(super) fn ensure_reference_with(
        &self,
        owner: &AuthorizedAgent,
        reference: &TaskRef,
        snapshots: &mut Snapshots,
        history_length: u32,
    ) -> Result<LocalTask, AppError> {
        if !snapshots.contains(owner) || !self.registered(owner) {
            return Err(local_error(
                "A2A_AGENT_SESSION_INVALID",
                "The originating agent instance is no longer active in this project.",
            ));
        }
        let _operation = self.operations.lock().map_err(|_| lock_error())?;
        if let Some(link) = self
            .state
            .lock()
            .map_err(|_| lock_error())?
            .tasks
            .values()
            .find(|link| link.recipient == *owner && &link.reference == reference)
            .cloned()
        {
            self.valid_reference_with(&link, snapshots)?;
            return self.descriptor_with(&link, snapshots, history_length);
        }
        let target_id = self
            .state
            .lock()
            .map_err(|_| lock_error())?
            .agents
            .get(&owner.ticket)
            .filter(|record| record.owner == *owner)
            .map(|record| record.id.clone())
            .ok_or_else(missing)?;
        let (instruction, room_name, sender_tab) = if let Some(room_id) = &reference.room_id {
            let room = snapshots.room(self, room_id).ok_or_else(changed)?;
            let member = room.member_by_tab(&owner.tab_id).ok_or_else(changed)?;
            if crate::collab::inbox::normalize_root(&room.project_root) != owner.root {
                return Err(changed());
            }
            let task = room
                .tasks
                .iter()
                .find(|task| {
                    task.id == reference.id
                        && task.generation == reference.generation
                        && task.assignee.as_deref() == Some(&member.id)
                        && matches!(task.status, TaskStatus::Planned | TaskStatus::Active)
                })
                .ok_or_else(changed)?;
            (
                if task.outcome.is_empty() {
                    task.title.clone()
                } else {
                    format!("{}\n{}", task.title, task.outcome)
                },
                Some(room.name.clone()),
                room.active_member(&task.created_by)
                    .map(|member| member.tab_id.clone()),
            )
        } else {
            if reference.kind != "direct_task" || reference.generation != 1 {
                return Err(changed());
            }
            let task = snapshots
                .tasks(self)
                .get(&reference.id)
                .filter(|task| {
                    task.to == owner.tab_id
                        && task.project_root.as_deref() == Some(&owner.root)
                        && task.chat.is_none()
                        && !task::is_settled(&task.state)
                })
                .ok_or_else(changed)?;
            (task.instruction.clone(), None, Some(task.from.clone()))
        };
        let sender = sender_tab.and_then(|tab| {
            self.state
                .lock()
                .ok()?
                .agents
                .values()
                .find(|record| record.owner.tab_id == tab && record.owner.root == owner.root)
                .map(|record| record.owner.clone())
        });
        let link = Link {
            id: id(),
            context_id: id(),
            sender,
            recipient: owner.clone(),
            target_id,
            reference: reference.clone(),
            report_handle: id(),
            instruction,
            progress: Progress::Submitted,
            status_text: None,
            artifacts: vec![],
            history: vec![],
            question_ids: vec![],
            room_name,
            used: Instant::now(),
        };
        let mut state = self.state.lock().map_err(|_| lock_error())?;
        capacity(&mut state, owner)?;
        state.tasks.insert(link.id.clone(), link.clone());
        drop(state);
        // Do not overwrite a persisted report preview with a recovery link's
        // initial SUBMITTED state; only real send/report/cancel transitions
        // update the durable preview.
        self.descriptor_with(&link, snapshots, history_length)
    }

    pub(super) fn local_tasks(
        &self,
        owner: &AuthorizedAgent,
        room_hint: Option<&str>,
    ) -> Result<Value, AppError> {
        self.current(owner)?;
        let mut snapshots = Snapshots::load_required(self)?;
        let mut references = vec![];
        if room_hint.is_none() {
            references.extend(
                snapshots
                    .tasks(self)
                    .values()
                    .filter(|task| {
                        task.to == owner.tab_id
                            && task.project_root.as_deref() == Some(&owner.root)
                            && task.chat.is_none()
                            && !task::is_settled(&task.state)
                    })
                    .map(|task| TaskRef {
                        kind: "direct_task".into(),
                        room_id: None,
                        id: task.id.clone(),
                        generation: 1,
                    }),
            );
        }
        let rooms = if let Some(hint) = room_hint {
            vec![
                self.rooms
                    .read_as_member(&owner.tab_id, Some(hint), |room, _| room.clone())
                    .map_err(business)?,
            ]
        } else {
            self.rooms.my_rooms(&owner.tab_id)
        };
        for room in rooms {
            if crate::collab::inbox::normalize_root(&room.project_root) != owner.root {
                continue;
            }
            let Some(member) = room.member_by_tab(&owner.tab_id) else {
                continue;
            };
            references.extend(
                room.tasks
                    .iter()
                    .filter(|task| {
                        task.assignee.as_deref() == Some(&member.id)
                            && matches!(task.status, TaskStatus::Planned | TaskStatus::Active)
                    })
                    .map(|task| TaskRef {
                        kind: "room_task".into(),
                        room_id: Some(room.id.clone()),
                        id: task.id.clone(),
                        generation: task.generation,
                    }),
            );
        }
        references.sort_by(|a, b| a.room_id.cmp(&b.room_id).then(a.id.cmp(&b.id)));
        let mut tasks = Vec::new();
        let mut bytes = 0usize;
        let mut omitted = 0usize;
        for (index, reference) in references.iter().enumerate() {
            // The list omits history; A2ALocalTask returns the full task.
            let task = self.ensure_reference_with(owner, reference, &mut snapshots, 0)?;
            let size = serde_json::to_vec(&task)
                .map(|value| value.len())
                .unwrap_or(usize::MAX);
            if !tasks.is_empty() && bytes.saturating_add(size) > MAX_LIST_BYTES {
                omitted = references.len() - index;
                break;
            }
            bytes = bytes.saturating_add(size);
            tasks.push(task);
        }
        let mut value = json!({"tasks": tasks});
        if omitted > 0 {
            value["truncated"] = json!(true);
            value["omitted"] = json!(omitted);
        }
        Ok(value)
    }
}

fn check_room_reference(room: &Room, link: &Link) -> Result<(), String> {
    let member = room
        .member_by_tab(&link.recipient.tab_id)
        .ok_or("The recipient left this room.")?;
    if crate::collab::inbox::normalize_root(&room.project_root) != link.recipient.root
        || !room.tasks.iter().any(|task| {
            task.id == link.reference.id
                && task.generation == link.reference.generation
                && task.assignee.as_deref() == Some(&member.id)
        })
    {
        return Err("The task assignment lifecycle changed.".into());
    }
    Ok(())
}
fn not_cancelable() -> AppError {
    local_error(
        "A2A_TASK_NOT_CANCELABLE",
        "This task cannot safely be canceled; it may be running or belongs to the room authority.",
    )
}
fn validate_report(input: &ReportInput, link: &Link) -> Result<(), AppError> {
    let text = input.text.as_deref().unwrap_or("");
    let total = text.len()
        + input
            .artifacts
            .iter()
            .map(|artifact| artifact.text.len() + artifact.name.as_ref().map_or(0, String::len))
            .sum::<usize>();
    if total > 64 * 1024
        || input.artifacts.len() > 16
        || input.artifacts.iter().any(|artifact| {
            artifact.text.trim().is_empty()
                || artifact
                    .name
                    .as_ref()
                    .is_some_and(|name| name.chars().count() > 120 || name.len() > 512)
        })
        || matches!(
            input.state,
            ReportState::InputRequired | ReportState::Failed
        ) && text.trim().is_empty()
        || matches!(input.state, ReportState::Completed)
            && text.trim().is_empty()
            && input.artifacts.is_empty()
        || link.artifacts.len() + input.artifacts.len() > 32
        || link
            .artifacts
            .iter()
            .map(|v| v.to_string().len())
            .sum::<usize>()
            + total
            > 256 * 1024
    {
        return Err(local_error(
            "A2A_LOCAL_REPORT_INVALID",
            "Provide a valid bounded text report and meaningful result, input request, or failure explanation.",
        ));
    }
    Ok(())
}
