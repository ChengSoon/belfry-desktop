use super::model::*;
use crate::{
    collab::{
        SessionRegistry,
        task::{CollabTask, DeliveryPhase as OldPhase, TaskOrigin, TaskState},
    },
    rooms::model::{Room, TaskStatus},
};
use belfry_protocol::inbox::*;
use std::collections::{BTreeMap, BTreeSet, HashMap};

#[derive(Clone)]
pub(super) struct Seed {
    pub source_seq: u64,
    pub entry: Entry,
    pub blocker: Option<Status>,
    pub cancelled: bool,
    pub completed: bool,
    pub legacy: Option<(String, String, u64)>,
}
pub(super) struct Snapshot {
    pub seeds: BTreeMap<String, Seed>,
    pub active_tasks: BTreeMap<String, String>, // task key -> session key
    pub started: BTreeMap<String, Vec<TaskRef>>,
    pub revision: u64,
    pub members: BTreeMap<String, BTreeMap<String, bool>>,
    pub member_ids: BTreeMap<String, BTreeMap<String, String>>,
    pub native_unready: BTreeMap<String, String>,
}

pub(crate) fn normalize_root(raw: &str) -> String {
    let path = if raw.starts_with("file:") {
        crate::resource::file_uri_to_path(raw).ok()
    } else {
        Some(std::path::PathBuf::from(raw))
    };
    path.map(|path| crate::resource::canonicalize(&path).unwrap_or(path).to_string_lossy().into_owned())
        .unwrap_or_else(|| raw.to_string())
}
pub(crate) fn session_key(root: &str, tab: &str) -> String {
    format!("s:{}", operation_hash(&(normalize_root(root), tab)))
}
fn entry_id(source: &Source, recipient: &Recipient) -> String {
    format!("e:{}", operation_hash(&(&source.kind, &source.room_id, &source.message_id, &recipient.id)))
}
fn actor(room: &Room, id: &str, semantics: Option<&MessageSemantics>) -> Actor {
    let member = room.members.iter().find(|member| member.id == id);
    Actor {
        id: id.into(),
        name: semantics.and_then(|s| s.sender_name.clone()).unwrap_or_else(|| room.label(id)),
        tab_id: semantics.and_then(|s| s.sender_tab.clone()).or_else(|| member.map(|m| m.tab_id.clone())),
        member_id: member.map(|m| m.id.clone()),
    }
}
fn base(
    source: Source,
    recipient: Recipient,
    by: Actor,
    topic_id: String,
    class: MessageClass,
    text: String,
    created_at: i64,
) -> Entry {
    let id = entry_id(&source, &recipient);
    Entry {
        source_revision: 1,
        view: MessageView {
            id,
            message_id: source.message_id.clone(),
            revision: 1,
            source,
            recipient,
            topic_id,
            class,
            by,
            created_at,
            text,
            attachments: vec![],
            reply_to: None,
            reply_preview: None,
            questions: vec![],
            replies: vec![],
            delivery_phase: DeliveryPhase::Pending,
            delivery_status: Status::new("collecting"),
            handling_status: Status::new("unknown_handling"),
            waiting_reason: None,
        },
        enqueue_seq: 0,
        received_at: created_at,
        answers: vec![],
        task: None,
        batch_id: None,
        handling: Handling::Unconfirmed,
    }
}

pub(super) fn snapshot(
    rooms: &[Room],
    tasks: &HashMap<String, CollabTask>,
    registry: &SessionRegistry,
    revision: u64,
) -> Snapshot {
    let mut out = Snapshot {
        seeds: BTreeMap::new(),
        active_tasks: BTreeMap::new(),
        started: BTreeMap::new(),
        revision,
        members: BTreeMap::new(),
        member_ids: BTreeMap::new(),
        native_unready: BTreeMap::new(),
    };
    for room in rooms {
        out.member_ids.insert(
            room.id.clone(),
            room.active_members().map(|member| (member.tab_id.clone(), member.id.clone())).collect(),
        );
        out.members.insert(
            room.id.clone(),
            room.active_members()
                .map(|member| (member.tab_id.clone(), member.role == crate::rooms::model::MemberRole::Foreman))
                .collect(),
        );
        let root = normalize_root(&room.project_root);
        for task in &room.tasks {
            if let Some(member) = task.assignee.as_ref().and_then(|id| room.active_member(id))
                && matches!(task.status, TaskStatus::Active | TaskStatus::Planned)
            {
                let reference = TaskRef {
                    kind: "room_task".into(),
                    room_id: Some(room.id.clone()),
                    id: task.id.clone(),
                    generation: task.generation,
                };
                let key = session_key(&root, &member.tab_id);
                out.active_tasks.insert(task_key(&reference), key.clone());
                // Existing legacy assignments have no machine-readable delivered assignment. Hold them conservatively.
                if task.status == TaskStatus::Active || task.generation == 0 {
                    out.started.entry(key).or_default().push(reference);
                }
            }
        }
        for message in room.all_messages() {
            let fallback = crate::rooms::semantics::legacy(
                room,
                &message.id,
                &message.text,
                &message.to,
                message.mode,
                message.reply_to.as_deref(),
            );
            let semantics = message.inbox.as_ref().unwrap_or(&fallback);
            for member_id in message.to.iter().filter(|id| *id != "user") {
                let Some(member) = room.members.iter().find(|member| &member.id == member_id) else {
                    continue;
                };
                let tab = semantics
                    .recipient_tabs
                    .get(member_id)
                    .cloned()
                    .or_else(|| {
                        room.delivery_outbox
                            .iter()
                            .find(|entry| entry.message_id == message.id && entry.member_id == *member_id)
                            .and_then(|entry| entry.tab_id.clone())
                    })
                    .unwrap_or_else(|| member.tab_id.clone());
                let recipient = Recipient {
                    id: format!("room:{}:member:{member_id}:tab:{tab}", room.id),
                    session_key: session_key(&root, &tab),
                    project_root: root.clone(),
                    tab_id: tab.clone(),
                    room_id: Some(room.id.clone()),
                    member_id: Some(member_id.clone()),
                    name: member.title.clone(),
                    agent: member.agent.clone(),
                };
                let source = Source {
                    kind: "room".into(),
                    room_id: Some(room.id.clone()),
                    name: room.name.clone(),
                    message_id: message.id.clone(),
                };
                let assignment = semantics.class == MessageClass::TaskAssignment
                    && semantics.task_recipient.as_deref() == Some(member_id);
                let class = if semantics.class == MessageClass::TaskAssignment && !assignment {
                    MessageClass::Discussion
                } else {
                    semantics.class.clone()
                };
                let mut entry = base(
                    source,
                    recipient,
                    actor(room, &message.by, Some(semantics)),
                    semantics.topic_id.clone(),
                    class,
                    if assignment {
                        semantics.task_instruction.clone().unwrap_or_else(|| message.text.clone())
                    } else {
                        message.text.clone()
                    },
                    message.at,
                );
                entry.view.revision = semantics.revision.max(1);
                entry.source_revision = semantics.revision.max(1);
                entry.answers = semantics.answers.clone();
                entry.task = if assignment { semantics.task_ref.clone() } else { None };
                entry.view.reply_to = message.reply_to.clone();
                entry.view.reply_preview =
                    message.reply_to.as_ref().and_then(|id| room.message(id)).map(|original| ReplyView {
                        message_id: original.id.clone(),
                        by: actor(room, &original.by, original.inbox.as_ref()),
                        created_at: original.at,
                        text: crate::rooms::model::excerpt(&original.text, 240),
                        answers: original.inbox.as_ref().map(|s| s.answers.clone()).unwrap_or_default(),
                    });
                entry.view.attachments = message
                    .attachments
                    .iter()
                    .map(|a| Attachment {
                        id: a.id.clone(),
                        name: a.name.clone(),
                        path: a.path.clone(),
                        size: a.size,
                        mime_type: a.mime_type.clone(),
                    })
                    .collect();
                entry.view.questions = semantics
                    .questions
                    .iter()
                    .filter(|q| q.recipients.contains(member_id))
                    .map(|q| {
                        let replies = q.replies.get(member_id).cloned().unwrap_or_default();
                        QuestionView {
                            id: q.id.clone(),
                            text: q.text.clone(),
                            state: if q.replies.contains_key(member_id) {
                                "replied"
                            } else if q.cancelled_for.contains(member_id)
                                || message.reply_cancelled
                                || member.left_at.is_some()
                                || member.tab_id != tab
                            {
                                "cancelled"
                            } else {
                                "open"
                            }
                            .into(),
                            reply_message_ids: replies,
                            legacy: q.legacy,
                        }
                    })
                    .collect();
                entry.view.replies = room
                    .all_messages()
                    .filter(|reply| {
                        reply.reply_to.as_deref() == Some(&message.id)
                            || reply.inbox.as_ref().is_some_and(|s| {
                                s.answers.iter().any(|answer| semantics.questions.iter().any(|q| &q.id == answer))
                            })
                    })
                    .map(|reply| ReplyView {
                        message_id: reply.id.clone(),
                        by: actor(room, &reply.by, reply.inbox.as_ref()),
                        created_at: reply.at,
                        text: reply.text.clone(),
                        answers: reply.inbox.as_ref().map(|s| s.answers.clone()).unwrap_or_default(),
                    })
                    .collect();
                let mut cancelled = member.left_at.is_some() || member.tab_id != tab;
                let mut completed = false;
                let mut blocker = if room.paused { Some(Status::new("room_paused")) } else { None };
                if let Some(reference) = &entry.task {
                    match room.tasks.iter().find(|task| task.id == reference.id) {
                        Some(task)
                            if task.generation == reference.generation && task.assignee.as_ref() == Some(member_id) =>
                        {
                            completed = task.status == TaskStatus::Done;
                            cancelled |= matches!(task.status, TaskStatus::Done | TaskStatus::Archived);
                            let dependencies = crate::rooms::model::open_blockers(room, task);
                            if !dependencies.is_empty() {
                                blocker = Some(Status::new("task_dependency").with("task", dependencies.join(", ")));
                            }
                        }
                        _ => cancelled = true,
                    }
                }
                let legacy_task = tasks.values().find(|task| {
                    task.to == tab
                        && matches!(&task.origin, Some(TaskOrigin::Room { id, .. }) if id == &room.id)
                        && task.chat.as_ref().is_some_and(|chat| chat.message_ids.contains(&message.id))
                });
                let old_phase = legacy_task.map(|task| task.delivery.phase).or_else(|| {
                    room.delivery_outbox
                        .iter()
                        .find(|e| e.member_id == *member_id && e.message_id == message.id)
                        .map(|e| e.phase)
                });
                let legacy = if matches!(old_phase, Some(OldPhase::Submitting | OldPhase::Uncertain)) {
                    entry.view.delivery_phase = DeliveryPhase::Uncertain;
                    let legacy_id = legacy_task
                        .map(|task| task.id.clone())
                        .unwrap_or_else(|| format!("{}:{member_id}", message.id));
                    Some((
                        legacy_id.clone(),
                        legacy_task.and_then(|task| task.delivery.attempt_id.clone()).unwrap_or(legacy_id),
                        legacy_task.map_or(0, |task| task.delivery.sequence),
                    ))
                } else {
                    None
                };
                if message.delivered_to.contains(member_id) || matches!(old_phase, Some(OldPhase::Submitted)) {
                    entry.view.delivery_phase = DeliveryPhase::Submitted;
                } else if matches!(old_phase, Some(OldPhase::Cancelled)) {
                    cancelled = true;
                }
                out.seeds.insert(
                    entry.view.id.clone(),
                    Seed { source_seq: semantics.source_sequence, entry, blocker, cancelled, completed, legacy },
                );
            }
        }
    }
    for task in tasks.values().filter(|task| task.chat.is_none()) {
        let target = registry.find(&task.to);
        // Old direct tasks remain durable in their source while the fixed tab's
        // project is unknown; never manufacture a project-less delivery target.
        let Some(root) = task
            .project_root
            .clone()
            .or_else(|| target.as_ref().and_then(|s| s.project_root.clone()))
            .filter(|root| !root.is_empty())
            .map(|root| normalize_root(&root))
        else {
            continue;
        };
        let recipient = Recipient {
            id: format!("tab:{}", task.to),
            session_key: session_key(&root, &task.to),
            project_root: root,
            tab_id: task.to.clone(),
            room_id: None,
            member_id: None,
            name: target.as_ref().and_then(|s| s.name.clone()).unwrap_or_else(|| task.to.clone()),
            agent: target.as_ref().map(|s| s.agent.clone()).unwrap_or_default(),
        };
        let from = registry.find(&task.from);
        let reference = TaskRef { kind: "direct_task".into(), room_id: None, id: task.id.clone(), generation: 1 };
        let source = Source {
            kind: "direct_task".into(),
            room_id: None,
            name: from.as_ref().and_then(|s| s.name.clone()).unwrap_or_else(|| task.from.clone()),
            message_id: task.id.clone(),
        };
        let by = Actor {
            id: task.from.clone(),
            name: source.name.clone(),
            tab_id: Some(task.from.clone()),
            member_id: None,
        };
        let mut entry = base(
            source,
            recipient,
            by,
            format!("direct:{}", task.id),
            MessageClass::TaskAssignment,
            task.instruction.clone(),
            task.created_at,
        );
        entry.task = Some(reference.clone());
        let legacy = match task.delivery.phase {
            OldPhase::Submitted => {
                entry.view.delivery_phase = DeliveryPhase::Submitted;
                None
            }
            OldPhase::Submitting | OldPhase::Uncertain => {
                entry.view.delivery_phase = DeliveryPhase::Uncertain;
                Some((
                    task.id.clone(),
                    task.delivery.attempt_id.clone().unwrap_or_else(|| task.id.clone()),
                    task.delivery.sequence,
                ))
            }
            _ => None,
        };
        if !crate::collab::task::is_settled(&task.state) {
            out.active_tasks.insert(task_key(&reference), entry.view.recipient.session_key.clone());
            if task.state == TaskState::Dispatched {
                out.started.entry(entry.view.recipient.session_key.clone()).or_default().push(reference);
            }
        }
        out.seeds.insert(
            entry.view.id.clone(),
            Seed {
                source_seq: task.source_sequence,
                entry,
                blocker: if task.state == TaskState::PendingApproval {
                    Some(Status::new("approval_required"))
                } else {
                    None
                },
                cancelled: crate::collab::task::is_settled(&task.state),
                completed: matches!(task.state, TaskState::Done | TaskState::Failed),
                legacy,
            },
        );
    }
    out
}

/// Preserve original ages/identities. Source synchronization cannot reopen terminal delivery phases.
pub(super) fn merge(data: &mut Data, sources: &Snapshot) {
    let mut ordered: Vec<_> = sources.seeds.values().collect();
    ordered.sort_by(|a, b| {
        (a.entry.view.created_at, &a.entry.view.source.room_id, a.source_seq, &a.entry.view.id).cmp(&(
            b.entry.view.created_at,
            &b.entry.view.source.room_id,
            b.source_seq,
            &b.entry.view.id,
        ))
    });
    let mut legacy_groups: BTreeMap<String, Vec<&Seed>> = BTreeMap::new();
    for seed in ordered {
        let id = &seed.entry.view.id;
        if !data.entries.contains_key(id) {
            let mut entry = seed.entry.clone();
            entry.enqueue_seq = data.next_seq;
            data.next_seq += 1;
            if seed.cancelled && entry.view.delivery_phase == DeliveryPhase::Pending {
                entry.view.delivery_phase = DeliveryPhase::Abandoned;
            }
            data.entries.insert(id.clone(), entry);
            if let Some((legacy, _, _)) = &seed.legacy {
                legacy_groups.entry(format!("legacy:{legacy}")).or_default().push(seed);
            }
        }
        let entry = data.entries.get_mut(id).unwrap();
        let mut questions = seed.entry.view.questions.clone();
        if entry.view.delivery_phase == DeliveryPhase::Withdrawn {
            for question in &mut questions {
                if question.state == "open" {
                    question.state = "cancelled".into();
                }
            }
        }
        if entry.source_revision != seed.entry.source_revision
            || entry.view.questions != questions
            || entry.view.replies != seed.entry.view.replies
            || entry.view.reply_preview != seed.entry.view.reply_preview
        {
            entry.view.questions = questions;
            entry.view.replies = seed.entry.view.replies.clone();
            entry.view.reply_preview = seed.entry.view.reply_preview.clone();
            entry.view.revision += seed.entry.source_revision.saturating_sub(entry.source_revision).max(1);
            entry.source_revision = seed.entry.source_revision;
        }
        if seed.completed && entry.handling != Handling::Processed {
            entry.handling = Handling::Processed;
            entry.view.revision += 1;
        }
        if seed.entry.view.delivery_phase == DeliveryPhase::Submitted
            && entry.view.delivery_phase == DeliveryPhase::Pending
        {
            entry.view.delivery_phase = DeliveryPhase::Submitted;
            entry.view.revision += 1;
        }
        if entry.view.delivery_phase == DeliveryPhase::Submitted
            && let Some(task) = &entry.task
            && sources.active_tasks.contains_key(&task_key(task))
        {
            let slots = data.slots.entry(entry.view.recipient.session_key.clone()).or_default();
            if !slots.contains(task) {
                slots.push(task.clone());
            }
        }
    }
    for (id, seeds) in legacy_groups {
        if data.batches.contains_key(&id) {
            continue;
        }
        let first = &seeds[0].entry;
        let (_, attempt, sequence) = seeds[0].legacy.clone().unwrap();
        let payload = seeds.iter().map(|seed| seed.entry.view.text.as_str()).collect::<Vec<_>>().join("\n");
        let view = BatchView {
            id: id.clone(),
            attempt_id: attempt,
            revision: 1,
            sequence,
            recipient: first.view.recipient.clone(),
            target_epoch: "legacy-unknown".into(),
            terminal_session_id: String::new(),
            topic_id: first.view.topic_id.clone(),
            entry_ids: seeds.iter().map(|seed| seed.entry.view.id.clone()).collect(),
            message_ids: seeds.iter().map(|seed| seed.entry.view.message_id.clone()).collect(),
            payload_hash: hash(&payload),
            payload,
            content_mode: "legacy".into(),
            phase: "uncertain".into(),
            prepared_at: first.received_at,
            lease_expires_at: first.received_at,
        };
        for entry_id in &view.entry_ids {
            if let Some(entry) = data.entries.get_mut(entry_id) {
                entry.batch_id = Some(id.clone());
            }
        }
        data.batches.insert(
            id.clone(),
            Batch {
                view,
                offer: None,
                operation_id: id.clone(),
                operation_hash: String::new(),
                priority: false,
                receipt_hash: None,
            },
        );
    }
    let invalid: Vec<_> = data
        .entries
        .values()
        .filter(|entry| pending(&entry.view.delivery_phase))
        .filter(|entry| sources.seeds.get(&entry.view.id).is_none_or(|seed| seed.cancelled))
        .map(|entry| entry.view.id.clone())
        .collect();
    let mut aborts = BTreeSet::new();
    for id in &invalid {
        if let Some(entry) = data.entries.get(id)
            && entry.view.delivery_phase == DeliveryPhase::Prepared
            && let Some(batch) = &entry.batch_id
        {
            aborts.insert(batch.clone());
        }
    }
    for batch in aborts {
        abort(data, &batch);
    }
    for id in invalid {
        let entry = data.entries.get_mut(&id).unwrap();
        if entry.view.delivery_phase == DeliveryPhase::Pending {
            entry.view.delivery_phase = DeliveryPhase::Abandoned;
            entry.view.revision += 1;
        }
    }
    for slots in data.slots.values_mut() {
        slots.retain(|task| sources.active_tasks.contains_key(&task_key(task)));
    }
    for (key, started) in &sources.started {
        let slots = data.slots.entry(key.clone()).or_default();
        for task in started {
            if !slots.contains(task) {
                slots.push(task.clone());
            }
        }
    }
    data.waits
        .retain(|_, wait| wait.task.as_ref().is_none_or(|task| sources.active_tasks.contains_key(&task_key(task))));
}
