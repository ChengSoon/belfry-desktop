use super::{InboxService, model::*, read, source};
use crate::terminal::AppError;
use belfry_protocol::{ResponseData, inbox::*};
use serde_json::json;

impl InboxService {
    fn agent_room(&self, tab: &str, hint: Option<&str>) -> Result<Option<String>, AppError> {
        hint.map(|hint| {
            self.rooms.read_as_member(tab, Some(hint), |room, _| room.id.clone()).map_err(AppError::invalid_argument)
        })
        .transpose()
    }
    fn may_view(&self, tab: &str, entry: &Entry) -> bool {
        if entry.view.recipient.tab_id != tab && entry.view.by.tab_id.as_deref() != Some(tab) {
            return false;
        }
        entry
            .view
            .source
            .room_id
            .as_ref()
            .is_none_or(|id| self.rooms.get(id).is_ok_and(|room| room.member_by_tab(tab).is_some()))
    }
    pub(crate) fn agent(&self, tab: &str, command: &AgentCommand) -> Result<ResponseData, String> {
        self.agent_inner(tab, command)
            .map(|result| ResponseData::CollaborationInbox { result })
            .map_err(|error| error.message)
    }
    fn agent_inner(&self, tab: &str, command: &AgentCommand) -> Result<serde_json::Value, AppError> {
        if let AgentCommand::BatchGet { batch_id } = command {
            let (data, sources, _) = self.read_context()?;
            let batch =
                data.batches.get(batch_id).ok_or_else(|| AppError::not_found("Batch not found in your role scope"))?;
            authorize_batch(tab, &batch.view, &sources)?;
            return Ok(json!({"batch": batch.view}));
        }
        if let AgentCommand::Resolve { request, operation_id } = command {
            if operation_id.is_empty() || operation_id.len() > 128 {
                return Err(AppError::invalid_argument("Provide a stable operation ID"));
            }
            let key = format!("agent:{tab}:{operation_id}");
            let signature = operation_hash(command);
            let result = self.with_sources(|sources| {
                self.store.edit_after(
                    |data| {
                        let batch = data
                            .batches
                            .get(&request.batch.batch_id)
                            .ok_or_else(|| AppError::not_found("Batch not found in your role scope"))?;
                        authorize_batch(tab, &batch.view, sources)?;
                        if let Some(operation) = data.operations.get(&key) {
                            if operation.hash != signature {
                                return Err(AppError::conflict("Operation ID was reused with different content"));
                            }
                            return Ok(operation.result.clone());
                        }
                        let batch = super::scheduler::resolve(data, request)?;
                        let value = json!({"batch": batch});
                        data.operations.insert(key, Operation { hash: signature, result: value.clone() });
                        Ok(value)
                    },
                    |value| {
                        let batch: BatchView =
                            serde_json::from_value(value["batch"].clone()).map_err(|e| AppError::io(e.to_string()))?;
                        self.gate.finish(&batch.terminal_session_id, &batch.id);
                        Ok(value)
                    },
                )
            })?;
            if let Err(error) = self.flush_mirrors() {
                *self.sync_error.lock().unwrap() = Some(error.message);
            }
            return Ok(result);
        }
        if let AgentCommand::List { room, cursor, limit } = command {
            let room = self.agent_room(tab, room.as_deref())?;
            let (mut data, sources, error) = self.read_context()?;
            let revision = data.revision.saturating_add(sources.revision);
            let scope = operation_hash(&(tab, &room, "agent-list"));
            source::merge(&mut data, &sources);
            let entries: Vec<_> = data
                .entries
                .values()
                .filter(|entry| {
                    entry.view.recipient.tab_id == tab
                        && self.may_view(tab, entry)
                        && room.as_ref().is_none_or(|room| entry.view.source.room_id.as_ref() == Some(room))
                })
                .collect();
            let (entries, next_cursor) =
                read::page(entries, cursor.as_deref(), &scope, limit.unwrap_or(20).clamp(1, 30))?;
            let messages: Vec<_> =
                entries.iter().map(|entry| agent_view(entry, &data, &sources, &self.registry)).collect();
            let key = self.target_root(tab).ok().map(|root| source::session_key(&root, tab));
            return Ok(json!({"schemaVersion": SCHEMA_VERSION, "revision": revision, "messages": messages,
                "taskSlots": key.as_ref().and_then(|key| data.slots.get(key)), "waiting": key.as_ref().and_then(|key| data.waits.get(key)),
                "nextCursor": next_cursor, "loadError": error}));
        }
        if let AgentCommand::Read { message_id, cursor, limit } = command {
            let (mut data, sources, error) = self.read_context()?;
            let revision = data.revision.saturating_add(sources.revision);
            let scope = operation_hash(&(tab, message_id, "agent-read"));
            source::merge(&mut data, &sources);
            let entries: Vec<_> = data
                .entries
                .values()
                .filter(|entry| {
                    self.may_view(tab, entry)
                        && (entry.view.id == *message_id
                            || entry.view.message_id == *message_id
                            || crate::collab::task::short_id(&entry.view.message_id) == message_id)
                })
                .collect();
            if entries.is_empty() {
                return Err(AppError::not_found("Message not found in your authorized inbox"));
            }
            if entries.iter().any(|entry| entry.view.message_id != entries[0].view.message_id) {
                return Err(AppError::invalid_argument("Ambiguous message ID; use the full ID"));
            }
            let (entries, next_cursor) =
                read::page(entries, cursor.as_deref(), &scope, limit.unwrap_or(20).clamp(1, 30))?;
            return Ok(
                json!({"schemaVersion": SCHEMA_VERSION, "revision": revision, "messages": entries.iter().map(|entry| agent_view(entry, &data, &sources, &self.registry)).collect::<Vec<_>>(),
                "nextCursor": next_cursor, "loadError": error}),
            );
        }
        let operation = match command {
            AgentCommand::Ack { operation_id, .. }
            | AgentCommand::Wait { operation_id, .. }
            | AgentCommand::Policy { operation_id, .. }
            | AgentCommand::Withdraw { operation_id, .. } => operation_id,
            _ => unreachable!(),
        };
        if operation.is_empty() || operation.len() > 128 {
            return Err(AppError::invalid_argument("Provide a stable operation ID"));
        }
        let op_key = format!("agent:{tab}:{operation}");
        let op_hash = operation_hash(command);
        let root = self.target_root(tab)?;
        let key = source::session_key(&root, tab);
        let room_scope =
            if let AgentCommand::Policy { room, .. } = command { self.agent_room(tab, room.as_deref())? } else { None };
        let result = self.with_sources(|sources| self.store.edit(|data| {
            if !data.enabled { return Err(AppError::conflict("The inbox must be activated before changing Agent handling state")); }
            if let Some(previous) = data.operations.get(&op_key) {
                if previous.hash != op_hash { return Err(AppError::conflict("Operation ID was reused with different content")); }
                return Ok(previous.result.clone());
            }
            source::merge(data, sources);
            let member_allowed = |entry: &Entry| entry.view.source.room_id.as_ref().is_none_or(|id| sources.members.get(id).is_some_and(|members| members.contains_key(tab)));
            let owns_entry = |entry: &Entry| entry.view.recipient.tab_id == tab && entry.view.source.room_id.as_ref().is_none_or(|id| sources.member_ids.get(id).and_then(|members| members.get(tab)) == entry.view.recipient.member_id.as_ref());
            let result = match command {
                AgentCommand::Ack { entries, .. } | AgentCommand::Withdraw { entries, .. } => {
                    if entries.is_empty() || entries.len() > 100 { return Err(AppError::invalid_argument("Provide between 1 and 100 entry revisions")); }
                    let withdrawing = matches!(command, AgentCommand::Withdraw { .. });
                    let mut unique = std::collections::BTreeSet::new();
                    for requested in entries {
                        if !unique.insert(&requested.id) { return Err(AppError::invalid_argument("Duplicate entry ID")); }
                        let entry = data.entries.get(&requested.id).ok_or_else(|| AppError::not_found("Inbox entry not found"))?;
                        let authorized = if withdrawing { entry.view.by.tab_id.as_deref() == Some(tab) || entry.view.source.room_id.as_ref().is_some_and(|id| sources.members.get(id).and_then(|members| members.get(tab)).copied().unwrap_or(false)) } else { owns_entry(entry) };
                        if !authorized || !member_allowed(entry) { return Err(AppError::invalid_argument("This inbox entry is outside your role")); }
                        if entry.view.revision != requested.revision { return Err(AppError::conflict("Inbox entry changed; read it again")); }
                        if withdrawing && !matches!(entry.view.delivery_phase, DeliveryPhase::Pending | DeliveryPhase::Prepared) { return Err(AppError::conflict("Only entries without a submission intent may be withdrawn")); }
                    }
                    if !withdrawing && let AgentCommand::Ack { state, .. } = command && *state == Handling::Unconfirmed { return Err(AppError::invalid_argument("Acknowledgement state must be processing or processed")); }
                    let aborts: Vec<_> = entries.iter().filter_map(|requested| data.entries.get(&requested.id)).filter(|entry| entry.view.delivery_phase == DeliveryPhase::Prepared && (withdrawing || entry.view.class == MessageClass::Fyi)).filter_map(|entry| entry.batch_id.clone()).collect();
                    for id in aborts { abort(data, &id); }
                    for requested in entries {
                        let entry = data.entries.get_mut(&requested.id).unwrap();
                        if withdrawing {
                            entry.view.delivery_phase = DeliveryPhase::Withdrawn;
                            for question in &mut entry.view.questions { if question.state == "open" { question.state = "cancelled".into(); } }
                            let actor = entry.view.source.room_id.as_ref().and_then(|room| sources.member_ids.get(room)).and_then(|members| members.get(tab)).cloned().unwrap_or_else(|| tab.into());
                            data.mirrors.insert(entry.view.id.clone(), Mirror { entry_id: entry.view.id.clone(), batch_id: op_key.clone(), source: entry.view.source.clone(), recipient: entry.view.recipient.clone(), submitted: false, withdrawn_by: Some(actor) });
                        }
                        else if let AgentCommand::Ack { state, .. } = command {
                            if entry.handling == Handling::Processed && *state == Handling::Processing { return Err(AppError::conflict("Processed entries cannot regress to processing")); }
                            entry.handling = state.clone();
                        }
                        entry.view.revision += 1;
                    }
                    json!({"changed": entries.iter().map(|requested| EntryVersion { id: requested.id.clone(), revision: data.entries[&requested.id].view.revision }).collect::<Vec<_>>()})
                }
                AgentCommand::Wait { question_ids, task, clear, .. } => {
                    if question_ids.len() > 32 { return Err(AppError::invalid_argument("Too many questions in a wait declaration")); }
                    if let Some(task) = task && sources.active_tasks.get(&task_key(task)) != Some(&key) { return Err(AppError::invalid_argument("Wait task must be your current assignment lifecycle")); }
                    for question in question_ids {
                        if !data.entries.values().any(|entry| entry.view.by.tab_id.as_deref() == Some(tab) && member_allowed(entry) && entry.view.questions.iter().any(|q| q.id == *question && q.state != "cancelled")) { return Err(AppError::invalid_argument("Wait question is not one of your open questions")); }
                    }
                    if *clear { data.waits.remove(&key); } else { data.waits.insert(key.clone(), Wait { questions: question_ids.clone(), task: task.clone() }); }
                    json!({"waiting": data.waits.get(&key), "instruction": "Finish this Agent turn to allow incoming replies; this command does not block the terminal."})
                }
                AgentCommand::Policy { topic_id, expected_revision, priority, hold_until, resume, .. } => {
                    if priority.as_ref().is_some_and(|value| !matches!(value.as_str(), "normal" | "high")) { return Err(AppError::invalid_argument("Priority must be normal or high")); }
                    let entries: Vec<_> = data.entries.values().filter(|entry| entry.view.recipient.session_key == key && entry.view.topic_id == *topic_id && entry.view.source.room_id == room_scope && member_allowed(entry)).collect();
                    let first = entries.first().ok_or_else(|| AppError::not_found("Topic not found in your inbox; provide its full topic ID and room scope"))?;
                    let policy_key = policy_key(first);
                    let affected = entries.iter().filter(|entry| entry.view.delivery_phase == DeliveryPhase::Pending).count();
                    let unaffected: std::collections::BTreeSet<_> = entries.iter().filter_map(|entry| entry.batch_id.clone()).collect();
                    let policy = data.policies.entry(policy_key).or_default();
                    if policy.revision != *expected_revision { return Err(AppError::conflict("Topic policy changed; read the latest policy revision")); }
                    if let Some(priority) = priority { policy.high = priority == "high"; }
                    if *resume { policy.hold_until = None; } else if let Some(until) = hold_until { policy.hold_until = Some(*until); }
                    policy.revision += 1;
                    json!({"policyRevision": policy.revision, "affectedPendingCount": affected, "unaffectedBatchIds": unaffected})
                }
                _ => unreachable!(),
            };
            data.operations.insert(op_key, Operation { hash: op_hash, result: result.clone() });
            Ok(result)
        }))?;
        if matches!(command, AgentCommand::Withdraw { .. })
            && let Err(error) = self.flush_mirrors()
        {
            *self.sync_error.lock().unwrap() = Some(error.message);
        }
        Ok(result)
    }
}
fn agent_view(
    entry: &Entry,
    data: &Data,
    sources: &source::Snapshot,
    registry: &crate::collab::SessionRegistry,
) -> serde_json::Value {
    let mut value =
        serde_json::to_value(read::message(entry, data, sources, registry, now(), true)).expect("message DTO");
    value["taskRef"] = json!(entry.task);
    value["answers"] = json!(entry.answers);
    value["policy"] = json!(data.policies.get(&policy_key(entry)).cloned().unwrap_or_default());
    value
}

fn authorize_batch(tab: &str, batch: &BatchView, sources: &source::Snapshot) -> Result<(), AppError> {
    let allowed = match &batch.recipient.room_id {
        // Deleted sources cannot strand a session-wide uncertain intent. Only the
        // original authenticated tab keeps the right to inspect and settle it;
        // a coordinator in some other room acquires no authority over this batch.
        Some(room) => match sources.members.get(room) {
            Some(members) => members.get(tab).is_some_and(|coordinator| {
                *coordinator
                    || batch.recipient.tab_id == tab
                        && sources.member_ids.get(room).and_then(|members| members.get(tab))
                            == batch.recipient.member_id.as_ref()
            }),
            None => batch.recipient.tab_id == tab,
        },
        None => batch.recipient.tab_id == tab,
    };
    if allowed { Ok(()) } else { Err(AppError::not_found("Batch not found in your role scope")) }
}
