//! Source-owned topics, question obligations and assignment generations.
use super::{
    model::*,
    ops::{self, Posted},
};
use belfry_protocol::inbox::{MessageClass, MessageOptions, MessageSemantics, Question, TaskRef};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(super) fn operation_key(actor: &str, tab: Option<&str>, operation: &str) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(&(actor, tab, operation)).expect("operation identity")))
}

pub(super) fn remember_operation(
    room: &mut Room,
    by: &str,
    message_id: &str,
    to: &[String],
    semantics: Option<&MessageSemantics>,
) {
    let Some(semantics) = semantics else {
        return;
    };
    let (Some(operation), Some(hash)) = (&semantics.operation_id, &semantics.operation_hash) else {
        return;
    };
    let key = operation_key(by, semantics.sender_tab.as_deref(), operation);
    let receipt =
        room.message_operations.entry(key).or_insert_with(|| MessageOperation { hash: hash.clone(), posted: vec![] });
    if receipt.hash == *hash && !receipt.posted.iter().any(|post| post.message_id == message_id) {
        receipt.posted.push(Posted { message_id: message_id.into(), to: to.to_vec() });
    }
}

pub fn legacy(
    room: &Room,
    id: &str,
    text: &str,
    to: &[String],
    mode: MessageMode,
    reply: Option<&str>,
) -> MessageSemantics {
    let original = reply.and_then(|id| room.message(id));
    MessageSemantics {
        revision: 1,
        topic_id: original
            .and_then(|message| message.inbox.as_ref())
            .map(|semantics| semantics.topic_id.clone())
            .unwrap_or_else(|| format!("room:{}:{id}", room.id)),
        class: if reply.is_some() { MessageClass::Reply } else { MessageClass::Discussion },
        questions: if mode == MessageMode::RequestReply {
            vec![Question {
                id: format!("{id}:q1"),
                text: text.into(),
                recipients: to.iter().filter(|id| *id != "user").cloned().collect(),
                legacy: true,
                ..Default::default()
            }]
        } else {
            vec![]
        },
        answers: original
            .and_then(|message| message.inbox.as_ref())
            .map(|semantics| semantics.questions.iter().filter(|q| q.legacy).map(|q| q.id.clone()).collect())
            .unwrap_or_default(),
        recipient_tabs: to
            .iter()
            .filter_map(|id| room.active_member(id).map(|member| (id.clone(), member.tab_id.clone())))
            .collect(),
        ..Default::default()
    }
}

/// One-time upgrade; never infer an assignment from a localized notice.
pub fn migrate(room: &mut Room) {
    let snapshots: Vec<_> = room.all_messages().filter(|message| message.inbox.is_none()).cloned().collect();
    for (index, message) in snapshots.into_iter().enumerate() {
        let mut semantics =
            legacy(room, &message.id, &message.text, &message.to, message.mode, message.reply_to.as_deref());
        semantics.source_sequence = index as u64 + 1;
        semantics.sender_tab =
            room.members.iter().find(|member| member.id == message.by).map(|member| member.tab_id.clone());
        semantics.sender_name = Some(room.label(&message.by));
        for question in &mut semantics.questions {
            for recipient in &message.replied_by {
                let replies = room
                    .all_messages()
                    .filter(|reply| reply.reply_to.as_deref() == Some(&message.id) && reply.by == *recipient)
                    .map(|reply| reply.id.clone())
                    .collect();
                question.replies.insert(recipient.clone(), replies);
            }
            if message.reply_cancelled {
                question.cancelled_for = question.recipients.clone();
            }
        }
        if let Some(current) = room.message_mut(&message.id) {
            current.inbox = Some(semantics);
        }
    }
    let bindings: BTreeMap<_, _> =
        room.members.iter().map(|member| (member.id.clone(), member.tab_id.clone())).collect();
    for entry in &mut room.delivery_outbox {
        if entry.tab_id.is_none() {
            entry.tab_id = bindings.get(&entry.member_id).cloned();
        }
    }
    let snapshots: Vec<_> = room.all_messages().cloned().collect();
    for message in snapshots {
        remember_operation(room, &message.by, &message.id, &message.to, message.inbox.as_ref());
    }
}

pub fn tag_task(room: &mut Room, posted: &Posted, id: &str) {
    let Some(task) = room.tasks.iter().find(|task| task.id == id).cloned() else {
        return;
    };
    let room_id = room.id.clone();
    if let Some(message) = room.message_mut(&posted.message_id)
        && let Some(semantics) = &mut message.inbox
    {
        semantics.topic_id = format!("room:{room_id}:task:{id}:{}", task.generation);
        semantics.class = MessageClass::TaskAssignment;
        semantics.task_ref = Some(TaskRef {
            kind: "room_task".into(),
            room_id: Some(room_id.clone()),
            id: id.into(),
            generation: task.generation,
        });
        semantics.task_recipient = task.assignee;
        semantics.task_instruction = Some(format!(
            "{}\nTask {}: {}\nOutcome: {}\nDependencies: {}",
            message.text,
            task.id,
            task.title,
            task.outcome,
            task.blocked_by.join(", ")
        ));
    }
    if let Some(message) = room.message(&posted.message_id) {
        let event = super::ledger::message_event(&room_id, message);
        if let Some(pending) = room.pending.iter_mut().find(|event| event.id == posted.message_id) {
            *pending = event;
        }
    }
}

fn topic(room: &Room, raw: &str) -> Result<String, String> {
    if raw.is_empty() || raw.len() > 256 || raw.chars().any(char::is_control) {
        return Err("Invalid topic ID".into());
    }
    let scope = format!("room:{}:", room.id);
    if raw.starts_with("room:") {
        if !raw.starts_with(&scope) {
            return Err("Topic belongs to another room".into());
        }
        Ok(raw.into())
    } else {
        Ok(format!("{scope}{raw}"))
    }
}

/// All answer IDs are checked before posting anything. One durable reply per asking author.
#[allow(clippy::too_many_arguments)]
pub fn say(
    room: &mut Room,
    actor: &Actor,
    tokens: &[String],
    text: &str,
    reply: Option<&str>,
    ask: bool,
    options: &MessageOptions,
    now: i64,
) -> Result<Vec<Posted>, String> {
    if text.trim().is_empty() || text.chars().count() > MAX_TEXT_CHARS {
        return Err("Message text is empty or too long".into());
    }
    if options.questions.len() > 32
        || options.answers.len() > 32
        || options.questions.iter().any(|question| question.trim().is_empty() || question.chars().count() > 4000)
    {
        return Err("Questions exceed the supported limits".into());
    }
    if matches!(options.class, Some(MessageClass::TaskAssignment)) {
        return Err("Use the task commands to assign formal work".into());
    }
    let hash = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(actor.id(), tokens, text, reply, ask, options)).map_err(|error| error.to_string())?
        )
    );
    if let Some(operation) = &options.operation_id {
        if operation.is_empty() || operation.len() > 128 {
            return Err("Invalid operation ID".into());
        }
        let tab = match actor {
            Actor::Member(member) => Some(member.tab_id.as_str()),
            Actor::User => None,
        };
        if let Some(receipt) = room.message_operations.get(&operation_key(actor.id(), tab, operation)) {
            if receipt.hash != hash {
                return Err("Operation ID was already used with different content".into());
            }
            return Ok(receipt.posted.clone());
        }
        let previous: Vec<_> = room
            .all_messages()
            .filter(|message| {
                message.by == actor.id()
                    && message.inbox.as_ref().is_some_and(|semantics| {
                        semantics.operation_id.as_ref() == Some(operation) && semantics.sender_tab.as_deref() == tab
                    })
            })
            .collect();
        if !previous.is_empty() {
            if previous.iter().any(|message| message.inbox.as_ref().unwrap().operation_hash.as_ref() != Some(&hash)) {
                return Err("Operation ID was already used with different content".into());
            }
            return Ok(previous
                .iter()
                .map(|message| Posted { message_id: message.id.clone(), to: message.to.clone() })
                .collect());
        }
    }
    let original =
        reply.map(|hint| room.message(hint).cloned().ok_or("Referenced message was not found")).transpose()?;
    let correction = options
        .correction_of
        .as_ref()
        .map(|hint| room.message(hint).cloned().ok_or("Corrected message was not found"))
        .transpose()?;
    let mut answers = Vec::new();
    let mut askers: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut inherited_topics = Vec::new();
    for hint in &options.answers {
        let matches: Vec<_> = room
            .all_messages()
            .flat_map(|message| {
                message.inbox.iter().flat_map(move |semantics| {
                    semantics
                        .questions
                        .iter()
                        .filter(move |question| question.id == *hint)
                        .map(move |question| (message, semantics, question))
                })
            })
            .collect();
        let [(message, semantics, question)] = matches.as_slice() else {
            return Err(format!("Unknown or ambiguous question: {hint}"));
        };
        if let Actor::Member(member) = actor
            && semantics.recipient_tabs.get(&member.id) != Some(&member.tab_id)
        {
            return Err("Question belongs to a previous recipient binding".into());
        }
        if !question.recipients.iter().any(|id| id == actor.id()) {
            return Err(format!("Question {hint} is not addressed to you"));
        }
        if question.cancelled_for.iter().any(|id| id == actor.id()) || message.reply_cancelled {
            return Err(format!("Question {hint} has been cancelled"));
        }
        if answers.contains(hint) {
            return Err("Duplicate answer ID".into());
        }
        if message.by != "user" && room.active_member(&message.by).is_none() {
            return Err("The question author is no longer a member".into());
        }
        answers.push(hint.clone());
        inherited_topics.push(semantics.topic_id.clone());
        askers.entry(message.by.clone()).or_default().push(hint.clone());
    }
    for message in [&original, &correction].into_iter().flatten() {
        if let Some(semantics) = &message.inbox {
            inherited_topics.push(semantics.topic_id.clone());
        }
    }
    let id = new_id();
    let topic_id = options
        .topic_id
        .as_deref()
        .map(|value| topic(room, value))
        .transpose()?
        .or_else(|| inherited_topics.first().cloned())
        .unwrap_or_else(|| format!("room:{}:{id}", room.id));
    if inherited_topics.iter().any(|inherited| inherited != &topic_id) {
        return Err("Reply, correction and answers must share one topic".into());
    }
    let is_reply = original.is_some() || !answers.is_empty() || matches!(options.class, Some(MessageClass::Reply));
    if is_reply && (ask || !options.questions.is_empty()) {
        return Err("Post follow-up questions as a separate discussion in the same topic".into());
    }
    if matches!(options.class, Some(MessageClass::Fyi)) && (ask || is_reply || !options.questions.is_empty()) {
        return Err("FYI cannot require an answer or answer questions".into());
    }
    let implicit = tokens.is_empty() && mentions_in(room, text).is_empty();
    let to = if !askers.is_empty() {
        let recipients: Vec<_> = askers.keys().cloned().collect();
        if !tokens.is_empty() {
            let explicit = resolve_recipients(room, actor, tokens, text)?;
            if explicit.len() != recipients.len() || explicit.iter().any(|id| !recipients.contains(id)) {
                return Err("Answers must return to their question authors".into());
            }
        }
        if recipients.iter().any(|id| id == "user") && recipients.len() > 1 {
            return Err("User and Agent replies must be separate operations".into());
        }
        recipients
    } else if implicit
        && let Some(original) = &original
        && original.by != "system"
        && original.by != actor.id()
    {
        if original.by != "user" && room.active_member(&original.by).is_none() {
            return Err("Referenced author has left the room".into());
        }
        vec![original.by.clone()]
    } else {
        resolve_recipients(room, actor, tokens, text)?
    };
    if (ask || !options.questions.is_empty()) && to.iter().any(|id| id == "user") {
        return Err("Question obligations require an Agent recipient".into());
    }
    let question_texts =
        if options.questions.is_empty() && ask { vec![text.to_string()] } else { options.questions.clone() };
    let questions: Vec<_> = question_texts
        .iter()
        .enumerate()
        .map(|(index, text)| Question {
            id: format!("{id}:q{}", index + 1),
            text: text.clone(),
            recipients: to.clone(),
            legacy: options.questions.is_empty() && ask,
            ..Default::default()
        })
        .collect();
    if answers.is_empty()
        && let Some(original) = &original
        && let Some(semantics) = &original.inbox
    {
        answers.extend(
            semantics
                .questions
                .iter()
                .filter(|q| q.legacy && q.recipients.iter().any(|id| id == actor.id()))
                .map(|q| q.id.clone()),
        );
    }
    let groups = if askers.len() > 1 {
        askers.into_iter().map(|(author, answers)| (vec![author], answers)).collect()
    } else {
        vec![(to, answers)]
    };
    let mut posted = Vec::new();
    for (index, (to, answers)) in groups.into_iter().enumerate() {
        let semantics = MessageSemantics {
            topic_id: topic_id.clone(),
            class: options.class.clone().unwrap_or(if is_reply {
                MessageClass::Reply
            } else {
                MessageClass::Discussion
            }),
            questions: questions.clone(),
            answers,
            correction_of: correction.as_ref().map(|m| m.id.clone()),
            recipient_tabs: to
                .iter()
                .filter_map(|id| room.active_member(id).map(|m| (id.clone(), m.tab_id.clone())))
                .collect(),
            operation_id: options.operation_id.clone(),
            operation_hash: Some(hash.clone()),
            ..Default::default()
        };
        let reply_to = original.as_ref().map(|m| m.id.clone()).or_else(|| {
            room.all_messages()
                .find(|message| {
                    message.inbox.as_ref().is_some_and(|original| {
                        original.questions.iter().any(|question| semantics.answers.contains(&question.id))
                    })
                })
                .map(|m| m.id.clone())
        });
        posted.push(ops::post_semantic(
            room,
            MessageKind::Chat,
            actor.id(),
            text.trim().into(),
            to,
            if questions.is_empty() { MessageMode::Send } else { MessageMode::RequestReply },
            reply_to,
            vec![],
            now,
            if index == 0 { id.clone() } else { new_id() },
            semantics,
        ));
    }
    Ok(posted)
}
