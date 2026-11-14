use super::{
    model::*,
    source::{self, Snapshot},
};
use crate::{collab::SessionRegistry, terminal::AppError};
use belfry_protocol::inbox::*;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn availability(registry: &SessionRegistry, recipient: &Recipient) -> &'static str {
    let Some(session) = registry.find(&recipient.tab_id) else {
        return "offline";
    };
    if session.project_root.as_ref().is_none_or(|root| source::normalize_root(root) != recipient.project_root) {
        return "unavailable";
    }
    if matches!(session.activity.as_str(), "exited" | "offline") {
        return "offline";
    }
    match session.activity.as_str() {
        "idle" | "done" if session.can_receive => "ready",
        "idle" | "done" | "error" | "clear" | "unknown" => "unavailable",
        "blocked" | "needs_input" | "needs-input" | "awaiting-choice" | "awaiting_input" | "waiting" => "needs_input",
        _ => "busy",
    }
}

pub(super) fn blocker(
    entry: &Entry,
    data: &Data,
    sources: &Snapshot,
    registry: &SessionRegistry,
    now: i64,
    runtime: bool,
) -> Option<Status> {
    let Some(seed) = sources.seeds.get(&entry.view.id) else {
        return Some(Status::new("target_changed"));
    };
    if seed.cancelled
        || seed.entry.view.recipient != entry.view.recipient
            && (seed.entry.view.recipient.tab_id != entry.view.recipient.tab_id
                || seed.entry.view.recipient.project_root != entry.view.recipient.project_root)
    {
        return Some(Status::new("target_changed"));
    }
    if let Some(batch) = data.batches.values().find(|batch| {
        batch.view.recipient.session_key == entry.view.recipient.session_key && batch.view.phase == "uncertain"
    }) {
        return Some(Status::new("uncertain").with("batchId", &batch.view.id));
    }
    if let Some(status) = &seed.blocker {
        return Some(status.clone());
    }
    if let Some(policy) = data.policies.get(&policy_key(entry))
        && let Some(until) = policy.hold_until
        && until > now
    {
        return Some(Status::new("topic_held").with("until", until));
    }
    if entry.view.class == MessageClass::TaskAssignment
        && let Some(slots) = data.slots.get(&entry.view.recipient.session_key)
        && let Some(task) = slots.iter().find(|task| entry.task.as_ref() != Some(task))
    {
        return Some(Status::new("previous_task").with("task", &task.id));
    }
    if runtime {
        match availability(registry, &entry.view.recipient) {
            "offline" => return Some(Status::new("target_offline")),
            "unavailable" => return Some(Status::new("runtime_not_ready")),
            "busy" => return Some(Status::new("turn_busy")),
            "needs_input" => return Some(Status::new("awaiting_input")),
            _ => {}
        }
        if let Some(reason) = sources.native_unready.get(&entry.view.recipient.tab_id) {
            return Some(Status::new(reason));
        }
    }
    None
}

pub(super) fn message(
    entry: &Entry,
    data: &Data,
    sources: &Snapshot,
    registry: &SessionRegistry,
    now: i64,
    imported: bool,
) -> MessageView {
    let mut view = entry.view.clone();
    let code = match view.delivery_phase {
        DeliveryPhase::Pending if view.class == MessageClass::Fyi => "fyi",
        DeliveryPhase::Pending => "collecting",
        DeliveryPhase::Prepared => "prepared",
        DeliveryPhase::Submitting => "submitting",
        DeliveryPhase::Submitted => "submitted",
        DeliveryPhase::Uncertain => "uncertain",
        DeliveryPhase::Withdrawn => "withdrawn",
        DeliveryPhase::Abandoned => "abandoned",
    };
    view.delivery_status = Status::new(code);
    if let Some(batch) = &entry.batch_id {
        view.delivery_status = view.delivery_status.with("batchId", batch);
    }
    if entry
        .batch_id
        .as_ref()
        .and_then(|id| data.batches.get(id))
        .is_some_and(|batch| batch.view.content_mode == "reference")
        && view.delivery_phase == DeliveryPhase::Submitted
    {
        view.delivery_status.code = "reference".into();
    }
    view.waiting_reason = match view.delivery_phase {
        DeliveryPhase::Pending if view.class != MessageClass::Fyi => {
            if !imported {
                Some(Status::new("source_sync_pending"))
            } else {
                blocker(entry, data, sources, registry, now, true).or(Some(Status::new("queue_turn")))
            }
        }
        DeliveryPhase::Uncertain => Some(view.delivery_status.clone()),
        _ => None,
    };
    view.handling_status = Status::new(match entry.handling {
        Handling::Processing => "processing",
        Handling::Processed => "processed",
        Handling::Unconfirmed => "unknown_handling",
    });
    view
}

pub(super) fn sessions(
    project_root: &str,
    room_id: Option<&str>,
    data: &Data,
    sources: &Snapshot,
    registry: &SessionRegistry,
    error: Option<String>,
) -> SessionsView {
    let revision = data.revision.saturating_add(sources.revision);
    let imported: BTreeSet<_> = data.entries.keys().cloned().collect();
    let mut projected = data.clone();
    source::merge(&mut projected, sources);
    let now = now();
    let root = source::normalize_root(project_root);
    let mut groups: BTreeMap<String, Vec<MessageView>> = BTreeMap::new();
    for entry in projected.entries.values().filter(|entry| {
        entry.view.recipient.project_root == root
            && room_id.is_none_or(|room| entry.view.source.room_id.as_deref() == Some(room))
    }) {
        groups.entry(entry.view.recipient.session_key.clone()).or_default().push(message(
            entry,
            &projected,
            sources,
            registry,
            now,
            imported.contains(&entry.view.id),
        ));
    }
    // Existing sessions without messages are still stable rows, scoped to the requested project/room.
    if room_id.is_none() {
        for session in registry
            .all()
            .iter()
            .filter(|session| session.project_root.as_ref().is_some_and(|value| source::normalize_root(value) == root))
        {
            groups.entry(source::session_key(&root, &session.tab_id)).or_default();
        }
    }
    let mut sessions = Vec::new();
    for (key, mut messages) in groups {
        messages.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        let recipient = messages.last().map(|m| m.recipient.clone()).or_else(|| {
            registry.all().into_iter().find(|s| source::session_key(&root, &s.tab_id) == key).map(|s| Recipient {
                id: s.tab_id.clone(),
                session_key: key.clone(),
                project_root: root.clone(),
                tab_id: s.tab_id.clone(),
                room_id: None,
                member_id: None,
                name: s.name.unwrap_or(s.tab_id),
                agent: s.agent,
            })
        });
        let Some(recipient) = recipient else {
            continue;
        };
        let pending_messages: Vec<_> =
            messages.iter().filter(|m| m.class != MessageClass::Fyi && pending(&m.delivery_phase)).collect();
        let awaiting_reply_count = messages
            .iter()
            .filter(|m| m.delivery_phase == DeliveryPhase::Submitted)
            .flat_map(|m| &m.questions)
            .filter(|q| q.state == "open")
            .count();
        let summary = if let Some(message) = messages.iter().find(|m| m.delivery_phase == DeliveryPhase::Uncertain) {
            message.delivery_status.clone()
        } else if !pending_messages.is_empty() {
            let reasons: Vec<_> =
                pending_messages.iter().map(|m| m.waiting_reason.as_ref().unwrap_or(&m.delivery_status)).collect();
            if reasons.iter().all(|r| *r == reasons[0]) { reasons[0].clone() } else { Status::new("mixed_waiting") }
        } else if awaiting_reply_count > 0 {
            Status::new("waiting_reply")
        } else if messages.iter().any(|m| m.handling_status.code == "processing") {
            Status::new("processing")
        } else if messages.is_empty() {
            Status::new("empty")
        } else {
            Status::new("ready")
        };
        let active = registry.find(&recipient.tab_id);
        sessions.push(SessionView {
            session_key: key,
            tab_id: recipient.tab_id.clone(),
            name: active.as_ref().and_then(|s| s.name.clone()).unwrap_or_else(|| recipient.name.clone()),
            agent: active.map(|s| s.agent).unwrap_or_else(|| recipient.agent.clone()),
            project_root: root.clone(),
            runtime_availability: if availability(registry, &recipient) == "ready"
                && sources.native_unready.contains_key(&recipient.tab_id)
            {
                "unavailable"
            } else {
                availability(registry, &recipient)
            }
            .into(),
            summary_status: summary,
            pending_count: pending_messages.len(),
            awaiting_reply_count,
            last_message_preview: messages.last().map(|m| crate::rooms::model::excerpt(&m.text, 120)),
            last_message_at: messages.last().map(|m| m.created_at),
            oldest_pending_at: pending_messages.iter().map(|m| m.created_at).min(),
        });
    }
    sessions.sort_by(|a, b| b.last_message_at.cmp(&a.last_message_at).then_with(|| a.session_key.cmp(&b.session_key)));
    SessionsView { schema_version: SCHEMA_VERSION, revision, generated_at: now, sessions, load_error: error }
}

pub(super) fn messages(
    key: &str,
    room_id: Option<&str>,
    cursor: Option<&str>,
    limit: Option<usize>,
    message_id: Option<&str>,
    data: &Data,
    sources: &Snapshot,
    registry: &SessionRegistry,
    error: Option<String>,
) -> Result<MessagesView, AppError> {
    let revision = data.revision.saturating_add(sources.revision);
    let scope = operation_hash(&(key, room_id, message_id));
    let imported: BTreeSet<_> = data.entries.keys().cloned().collect();
    let mut projected = data.clone();
    source::merge(&mut projected, sources);
    let own: Vec<_> = projected.entries.values().filter(|entry| entry.view.recipient.session_key == key).collect();
    let roots: BTreeSet<_> = own.iter().map(|entry| entry.view.recipient.project_root.as_str()).collect();
    let referenced = |entry: &Entry| {
        own.iter().any(|reader| {
            reader.view.source.room_id == entry.view.source.room_id
                && reader.view.recipient.project_root == entry.view.recipient.project_root
                && (reader.view.reply_to.as_deref() == Some(&entry.view.message_id)
                    || entry.view.questions.iter().any(|question| reader.answers.contains(&question.id)))
        })
    };
    let entries: Vec<_> = projected
        .entries
        .values()
        .filter(|entry| {
            (entry.view.recipient.session_key == key
                || message_id.is_some()
                    && roots.contains(entry.view.recipient.project_root.as_str())
                    && referenced(entry))
                && room_id.is_none_or(|room| entry.view.source.room_id.as_deref() == Some(room))
                && message_id.is_none_or(|id| {
                    entry.view.id == id
                        || entry.view.message_id == id
                        || crate::collab::task::short_id(&entry.view.message_id) == id
                })
        })
        .collect();
    let (entries, next_cursor) = page(entries, cursor, &scope, limit.unwrap_or(30).clamp(1, 50))?;
    let at = now();
    Ok(MessagesView {
        schema_version: SCHEMA_VERSION,
        revision,
        messages: entries
            .iter()
            .map(|entry| message(entry, &projected, sources, registry, at, imported.contains(&entry.view.id)))
            .collect(),
        next_cursor,
        load_error: error,
    })
}
/// Stable history boundary: new arrivals do not invalidate a cursor for older messages.
pub(super) fn page<'a>(
    mut entries: Vec<&'a Entry>,
    cursor: Option<&str>,
    scope: &str,
    limit: usize,
) -> Result<(Vec<&'a Entry>, Option<String>), AppError> {
    if let Some(cursor) = cursor {
        let parts: Vec<_> = cursor.split('.').collect();
        if cursor.len() > 240 || parts.len() != 4 || parts[0] != "v1" || parts[3] != scope {
            return Err(AppError::invalid_argument("Inbox cursor belongs to another query or format"));
        }
        let before =
            parts[1].parse::<i64>().map_err(|_| AppError::invalid_argument("Invalid inbox cursor boundary"))?;
        let id = parts[2];
        if !id.starts_with("e:") || id.len() != 66 {
            return Err(AppError::invalid_argument("Invalid inbox cursor entry ID"));
        }
        entries.retain(|entry| (entry.view.created_at, entry.view.id.as_str()) < (before, id));
    }
    entries.sort_by(|a, b| (a.view.created_at, &a.view.id).cmp(&(b.view.created_at, &b.view.id)));
    let start = entries.len().saturating_sub(limit);
    let cursor = if start > 0 {
        Some(format!("v1.{}.{}.{}", entries[start].view.created_at, entries[start].view.id, scope))
    } else {
        None
    };
    Ok((entries[start..].to_vec(), cursor))
}
