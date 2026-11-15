use super::{
    Service,
    engine::{Snapshots, signature},
    local_error,
    types::{BusinessReplay, ReportInput},
};
use crate::{
    a2a::{A2aRuntime, connections::ConnectionSource, requests::Owner},
    collab::RoomDirectory,
    plugins::agent_connection::AuthorizedAgent,
    rooms::{
        self,
        model::{Actor, TaskStatus},
    },
    terminal::AppError,
};
use belfry_protocol::{
    Command, ResponseData, RoomTaskOp,
    inbox::{AgentCommand, MessageOptions, TaskRef},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Tasks {
    room: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Task {
    report_handle: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Inbox {
    room: Option<String>,
    message_id: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoomInput {
    room: String,
    count: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Brief {
    room: String,
    objective: Option<String>,
    focus: Option<String>,
    constraints: Option<Vec<String>>,
    operation_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Say {
    room: String,
    text: String,
    #[serde(default)]
    to: Vec<String>,
    reply_to: Option<String>,
    #[serde(default)]
    ask: bool,
    topic_id: Option<String>,
    #[serde(default)]
    questions: Vec<String>,
    #[serde(default)]
    answers: Vec<String>,
    operation_id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum TaskOp {
    Add {
        title: String,
        outcome: Option<String>,
        assignee: Option<String>,
        #[serde(default)]
        after: Vec<String>,
    },
    Assign {
        task: String,
        assignee: String,
    },
    Reopen {
        task: String,
    },
    Archive {
        task: String,
    },
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoomTaskInput {
    room: String,
    op: TaskOp,
    expected_generation: Option<u64>,
    request_id: String,
}
fn parse<T: for<'de> Deserialize<'de>>(value: &Value) -> Result<T, AppError> {
    serde_json::from_value(value.clone()).map_err(|_| {
        local_error(
            "A2A_ARGUMENT_INVALID",
            "Local collaboration arguments do not match the host contract.",
        )
    })
}
fn bounded(value: &str, max: usize) -> Result<(), AppError> {
    if value.is_empty() || value.len() > max {
        Err(local_error(
            "A2A_ARGUMENT_INVALID",
            "Provide a bounded nonempty identifier.",
        ))
    } else {
        Ok(())
    }
}
fn business(message: String) -> AppError {
    local_error("A2A_LOCAL_PERMISSION_OR_STATE", &message)
}

pub(in crate::a2a) fn dispatch(
    service: &Service,
    runtime: &A2aRuntime,
    connections: &dyn ConnectionSource,
    owner: &AuthorizedAgent,
    input: &Value,
    api: &str,
) -> Result<Value, AppError> {
    service.current(owner)?;
    let value = match api {
        "a2a.localReady" => {
            let _: Empty = parse(input)?;
            service.ready(owner)?
        }
        "a2a.localAgents" => {
            let _: Empty = parse(input)?;
            service.discovery(&owner.root, Some(owner))?
        }
        "a2a.localTasks" => {
            let request: Tasks = parse(input)?;
            service.local_tasks(owner, request.room.as_deref())?
        }
        "a2a.localTask" => {
            let request: Task = parse(input)?;
            bounded(&request.report_handle, 128)?;
            json!(service.report_task(owner, &request.report_handle)?)
        }
        "a2a.localReport" => {
            let request: ReportInput = parse(input)?;
            bounded(&request.report_handle, 128)?;
            json!(service.report(owner, request, &signature(input))?)
        }
        "a2a.localInbox" => {
            let request: Inbox = parse(input)?;
            if let Some(limit) = request.limit {
                if !(1..=30).contains(&limit) {
                    return Err(local_error(
                        "A2A_HISTORY_LIMIT",
                        "Inbox limit must be between 1 and 30.",
                    ));
                }
            }
            if let Some(cursor) = &request.cursor {
                bounded(cursor, 4096)?;
            }
            let listing = request.message_id.is_none();
            let command = if let Some(message) = request.message_id {
                bounded(&message, 256)?;
                AgentCommand::Read {
                    message_id: message,
                    cursor: request.cursor,
                    limit: request.limit,
                }
            } else {
                AgentCommand::List {
                    room: request.room,
                    cursor: request.cursor,
                    limit: request.limit,
                }
            };
            let ResponseData::CollaborationInbox { mut result } = service
                .inbox
                .agent(&owner.tab_id, &command)
                .map_err(business)?
            else {
                return Err(super::unavailable());
            };
            if let Some(messages) = result["messages"].as_array_mut() {
                let mut snapshots = Some(Snapshots::load(service));
                for message in messages {
                    // List responses are a directory, not a full-text read. Keep
                    // the bridge payload bounded; a messageId read returns the
                    // complete text.
                    if listing
                        && let Some(text) = message["text"].as_str()
                        && text.chars().count() > 8192
                    {
                        message["text"] = json!(text.chars().take(8192).collect::<String>());
                        message["textTruncated"] = json!(true);
                    }
                    if let (Some(snapshots), Ok(reference)) = (
                        snapshots.as_mut(),
                        serde_json::from_value::<TaskRef>(message["taskRef"].clone()),
                    ) {
                        if let Ok(task) =
                            service.ensure_reference_with(owner, &reference, snapshots, 0)
                        {
                            message["reportHandle"] = json!(task.report_handle);
                            message["generation"] = json!(task.generation);
                        }
                    }
                }
            }
            result
        }
        "a2a.localRooms" => {
            let _: Empty = parse(input)?;
            let rooms=service.rooms.my_rooms(&owner.tab_id).into_iter().filter(|room|crate::collab::inbox::normalize_root(&room.project_root)==owner.root)
                .filter_map(|room|{let member=room.member_by_tab(&owner.tab_id)?;Some(json!({"id":room.id,"name":room.name,
                    "myTitle":member.title,"myDuty":member.duty,"iAmForeman":member.role==rooms::model::MemberRole::Foreman,
                    "objective":room.brief.objective,"focus":room.brief.current_focus,"constraints":room.brief.constraints,
                    "paused":room.paused,"openTasks":room.tasks.iter().filter(|task|matches!(task.status,TaskStatus::Planned|TaskStatus::Active)).count()}))}).collect::<Vec<_>>();
            json!({"rooms":rooms})
        }
        "a2a.localRoom" => {
            let request: RoomInput = parse(input)?;
            bounded(&request.room, 256)?;
            if request
                .count
                .is_some_and(|count| !(1..=50).contains(&count))
            {
                return Err(local_error(
                    "A2A_HISTORY_LIMIT",
                    "Room log count must be between 1 and 50.",
                ));
            }
            let room = service.room_scope(owner, &request.room)?;
            let status = service.room_command(
                owner,
                &Command::RoomStatus {
                    room: Some(room.id.clone()),
                },
            )?;
            let log = service.room_command(
                owner,
                &Command::RoomLog {
                    room: Some(room.id.clone()),
                    count: request.count,
                },
            )?;
            json!({"roomId":room.id,"status":serde_json::to_value(status).map_err(|_|super::unavailable())?["status"],
                "log":log,"tasks":room.tasks})
        }
        "a2a.localRoomSay" => {
            let request: Say = parse(input)?;
            bounded(&request.room, 256)?;
            crate::a2a::validation::request_id(&request.operation_id)?;
            crate::a2a::validation::text(&request.text)?;
            if request.to.len() > 64
                || request.questions.len() > 32
                || request.answers.len() > 32
                || request.questions.iter().any(|text| text.len() > 64 * 1024)
                || request.to.iter().any(|to| to.len() > 512)
                || request.answers.iter().any(|id| id.len() > 256)
            {
                return Err(local_error(
                    "A2A_ARGUMENT_INVALID",
                    "Room message recipients or questions exceed the local limits.",
                ));
            }
            let room = service.room_scope(owner, &request.room)?;
            json!(service.room_command(
                owner,
                &Command::RoomSay {
                    room: Some(room.id),
                    text: request.text,
                    to: request.to,
                    reply_to: request.reply_to,
                    ask: request.ask,
                    inbox: Some(MessageOptions {
                        topic_id: request.topic_id,
                        questions: request.questions,
                        answers: request.answers,
                        operation_id: Some(request.operation_id),
                        ..Default::default()
                    })
                }
            )?)
        }
        "a2a.localRoomBrief" => {
            let request: Brief = parse(input)?;
            bounded(&request.room, 256)?;
            crate::a2a::validation::request_id(&request.operation_id)?;
            let size = request.objective.as_ref().map_or(0, String::len)
                + request.focus.as_ref().map_or(0, String::len)
                + request.constraints.as_ref().map_or(0, |constraints| {
                    constraints.iter().map(String::len).sum::<usize>()
                });
            if size > 64 * 1024
                || request
                    .constraints
                    .as_ref()
                    .is_some_and(|constraints| constraints.len() > 64)
            {
                return Err(local_error(
                    "A2A_ARGUMENT_INVALID",
                    "The room brief exceeds the local text limit.",
                ));
            }
            service.room_brief(owner, request, &signature(input))?
        }
        "a2a.localRoomTask" => {
            let request: RoomTaskInput = parse(input)?;
            bounded(&request.room, 256)?;
            crate::a2a::validation::request_id(&request.request_id)?;
            service.room_task(runtime, connections, owner, request)?
        }
        _ => {
            return Err(local_error(
                "A2A_API_UNSUPPORTED",
                "This local A2A host API is not implemented.",
            ));
        }
    };
    service.current(owner)?;
    Ok(value)
}

impl Service {
    fn business_cached(&self, key: &str, digest: &str) -> Result<Option<Value>, AppError> {
        let mut state = self.state.lock().map_err(|_| super::lock_error())?;
        state.business_replay.retain(|_, replay| {
            replay.used.elapsed() < std::time::Duration::from_secs(24 * 60 * 60)
        });
        if let Some(replay) = state.business_replay.get(key) {
            if replay.signature != digest {
                return Err(local_error(
                    "A2A_LOCAL_OPERATION_CONFLICT",
                    "An operation ID was reused with different content.",
                ));
            }
            return Ok(Some(replay.value.clone()));
        }
        if state.business_replay.len() >= 4096 {
            return Err(local_error(
                "A2A_LOCAL_TASK_LIMIT",
                "The local protocol task or operation limit was reached.",
            ));
        }
        Ok(None)
    }
    fn remember_business(&self, key: String, digest: &str, value: &Value) -> Result<(), AppError> {
        self.state
            .lock()
            .map_err(|_| super::lock_error())?
            .business_replay
            .insert(
                key,
                BusinessReplay {
                    signature: digest.into(),
                    value: value.clone(),
                    used: std::time::Instant::now(),
                },
            );
        Ok(())
    }
    fn room_brief(
        &self,
        owner: &AuthorizedAgent,
        input: Brief,
        digest: &str,
    ) -> Result<Value, AppError> {
        let _operation = self.operations.lock().map_err(|_| super::lock_error())?;
        let room = self.room_scope(owner, &input.room)?;
        if !room
            .member_by_tab(&owner.tab_id)
            .is_some_and(|member| Actor::Member(member).coordinates())
        {
            return Err(business(
                "Only the room coordinator can update the brief.".into(),
            ));
        }
        let key = format!("{}:brief:{}", owner.ticket, input.operation_id);
        if let Some(value) = self.business_cached(&key, digest)? {
            return Ok(value);
        }
        let value = json!(self.room_command(
            owner,
            &Command::RoomBrief {
                room: Some(room.id),
                objective: input.objective,
                focus: input.focus,
                constraints: input.constraints
            }
        )?);
        self.remember_business(key, digest, &value)?;
        Ok(value)
    }
    fn room_scope(
        &self,
        owner: &AuthorizedAgent,
        hint: &str,
    ) -> Result<rooms::model::Room, AppError> {
        let room = self
            .rooms
            .read_as_member(&owner.tab_id, Some(hint), |room, _| room.clone())
            .map_err(business)?;
        if crate::collab::inbox::normalize_root(&room.project_root) != owner.root {
            return Err(local_error(
                "A2A_LOCAL_PERMISSION_OR_STATE",
                "The room belongs to a different project.",
            ));
        }
        Ok(room)
    }
    fn room_command(
        &self,
        owner: &AuthorizedAgent,
        command: &Command,
    ) -> Result<ResponseData, AppError> {
        let directory = rooms::MemberDirectory {
            store: self.rooms.clone(),
            registry: self.registry.clone(),
        };
        let (result, posts) = directory.handle(&owner.tab_id, command).map_err(business)?;
        if directory
            .enqueue_posts(&self.board, &self.registry, &posts)
            .is_err()
        {
            log::warn!("Local A2A room operation retained posts in the durable outbox");
        }
        Ok(result)
    }
    fn room_task(
        &self,
        runtime: &A2aRuntime,
        connections: &dyn ConnectionSource,
        owner: &AuthorizedAgent,
        input: RoomTaskInput,
    ) -> Result<Value, AppError> {
        let room = self.room_scope(owner, &input.room)?;
        let mut own_assignee = None;
        if let TaskOp::Add {
            title,
            outcome,
            assignee: Some(assignee),
            after,
        } = &input.op
        {
            let member = room
                .member_by_tab(&owner.tab_id)
                .ok_or_else(super::unavailable)?;
            let target = room
                .active_members()
                .find(|m| m.id == *assignee || m.title == assignee.trim_start_matches('@'))
                .ok_or_else(|| business("The requested room assignee is not active.".into()))?;
            rooms::model::may_assign(&room, &Actor::Member(member), Some(&target.id))
                .map_err(business)?;
            if target.tab_id == owner.tab_id {
                own_assignee = Some(target.title.clone());
            } else {
                match self.record_for_tab(owner, &target.tab_id) {
                    Ok(record) => {
                        let text = outcome
                            .as_deref()
                            .filter(|text| !text.trim().is_empty())
                            .unwrap_or(title);
                        let reply = tauri::async_runtime::block_on(runtime.send_message_context(
                            connections,
                            &Owner::agent(owner.root.clone(), owner.ticket.clone()),
                            &format!("local:{}", record.id),
                            &input.request_id,
                            text,
                            None,
                            Some(json!({"room":room.id,"title":title,"after":after})),
                        ))?;
                        let reply =
                            serde_json::to_value(reply).map_err(|_| super::unavailable())?;
                        let reference: TaskRef = serde_json::from_value(
                            reply["task"]["metadata"]["belfry"]["taskRef"].clone(),
                        )
                        .map_err(|_| super::unavailable())?;
                        let updated = self.room_scope(owner, &room.id)?;
                        let task = updated
                            .tasks
                            .iter()
                            .find(|task| {
                                task.id == reference.id && task.generation == reference.generation
                            })
                            .ok_or_else(super::unavailable)?;
                        return Ok(
                            json!({"roomId":room.id,"taskRef":reference,"task":task,"agentReply":reply}),
                        );
                    }
                    Err(error) if error.code.0.as_ref() != "A2A_LOCAL_AGENT_NOT_FOUND" => {
                        return Err(error);
                    }
                    Err(_) => {
                        // A human member or a CLI without a verified A2A adapter:
                        // create the authoritative room task instead of failing.
                        // The normal room/inbox delivery still notifies them.
                    }
                }
            }
        }
        let _operation = self.operations.lock().map_err(|_| super::lock_error())?;
        let replay_key = format!("{}:room-task:{}", owner.ticket, input.request_id);
        let digest = signature(&serde_json::to_value(&input).map_err(|_| super::unavailable())?);
        if let Some(value) = self.business_cached(&replay_key, &digest)? {
            return Ok(value);
        }
        let (key, op) = match input.op {
            TaskOp::Add {
                title,
                outcome,
                assignee,
                after,
            } => (
                None,
                RoomTaskOp::Add {
                    title,
                    outcome,
                    assignee: own_assignee.or(assignee),
                    after,
                },
            ),
            TaskOp::Assign { task, assignee } => {
                (Some(task.clone()), RoomTaskOp::Assign { task, assignee })
            }
            TaskOp::Reopen { task } => (Some(task.clone()), RoomTaskOp::Reopen { task }),
            TaskOp::Archive { task } => (Some(task.clone()), RoomTaskOp::Archive { task }),
        };
        let ((key,posted),updated)=self.rooms.mutate_as_member(&owner.tab_id,Some(&room.id),|room,member| {
            if crate::collab::inbox::normalize_root(&room.project_root)!=owner.root {return Err("Room project scope changed.".into());}
            if let Some(key)=&key {
                if input.expected_generation.is_none() || room.task_index(key).is_none_or(|index|Some(room.tasks[index].generation)!=input.expected_generation){return Err("Task lifecycle generation changed. Read the room context before changing it.".into());}
            }
            let actor=Actor::Member(member);let now=rooms::model::now_millis();
            match &op {
                RoomTaskOp::Add{title,outcome,assignee,after}=>rooms::ops::task_add(room,&actor,title,outcome.as_deref(),assignee.as_deref(),after,now),
                RoomTaskOp::Assign{task,assignee}=>rooms::ops::task_assign(room,&actor,task,assignee,now).map(|posts|(task.clone(),posts)),
                RoomTaskOp::Reopen{task}=>rooms::ops::task_reopen(room,&actor,task,now).map(|posts|(task.clone(),posts)),
                RoomTaskOp::Archive{task}=>rooms::ops::task_archive(room,&actor,task,now).map(|posts|(task.clone(),posts)),
                _=>Err("Use a bound protocol report handle to report task progress or results.".into()),
            }
        }).map_err(business)?;
        let posts = rooms::store_deliveries(&updated, &posted);
        if self
            .rooms
            .enqueue_posts(&self.board, &self.registry, &posts)
            .is_err()
        {
            log::warn!("Local A2A task operation retained posts in the durable outbox");
        }
        let task = updated
            .tasks
            .iter()
            .find(|task| task.id == key)
            .ok_or_else(super::unavailable)?;
        let value = json!({"roomId":updated.id,"taskRef":{"kind":"room_task","roomId":updated.id,"id":key,"generation":task.generation},"task":task});
        self.remember_business(replay_key, &digest, &value)?;
        Ok(value)
    }

    pub(super) fn snapshot(&self, root: &str) -> Result<Value, AppError> {
        let mut links = self
            .state
            .lock()
            .map_err(|_| super::lock_error())?
            .tasks
            .values()
            .filter(|link| link.recipient.root == root)
            .cloned()
            .collect::<Vec<_>>();
        let mut snapshots = Snapshots::load_required(self)?;
        links.sort_by(|a, b| {
            snapshots
                .contains(&b.recipient)
                .cmp(&snapshots.contains(&a.recipient))
                .then(b.used.cmp(&a.used))
        });
        let mut unique = std::collections::HashSet::new();
        let mut tasks = vec![];
        for link in links {
            if tasks.len() >= 128 {
                break;
            }
            let key = signature(&json!(link.reference));
            if unique.contains(&key) {
                continue;
            }
            let Ok(task) = self.task_value_with(&link, 0, &mut snapshots) else {
                continue;
            };
            unique.insert(key);
            let original = task["status"]["message"]["parts"][0]["text"].as_str();
            let text = original.map(|text| text.chars().take(4096).collect::<String>());
            let artifacts=link.artifacts.iter().map(|artifact|{let original=artifact["parts"][0]["text"].as_str().unwrap_or("");
                json!({"artifactId":artifact["artifactId"],"name":artifact["name"],"text":original.chars().take(512).collect::<String>(),"truncated":original.chars().count()>512})}).collect::<Vec<_>>();
            tasks.push(json!({"taskRef":link.reference,"protocolTaskId":link.id,"state":task["status"]["state"],
                "text":text,"textTruncated":original.is_some_and(|text|text.chars().count()>4096),"artifacts":artifacts,"source":"localA2A"}));
        }
        // Keep the last protocol preview visible after a host restart. The
        // in-memory link wins when both exist for the same reference.
        for preview in self.links.list(root) {
            if tasks.len() >= 128 {
                break;
            }
            let Ok(reference) = serde_json::from_value::<TaskRef>(preview["taskRef"].clone())
            else {
                continue;
            };
            // Do not resurrect a preview whose authoritative task or room was
            // deleted while the app was closed.
            if !snapshots.has_reference(self, &reference, root) {
                continue;
            }
            if unique.insert(signature(&preview["taskRef"])) {
                tasks.push(preview);
            }
        }
        Ok(json!({"tasks":tasks}))
    }
}
