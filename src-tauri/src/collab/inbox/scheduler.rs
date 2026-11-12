use super::{model::*, read, source::Snapshot};
use crate::{collab::SessionRegistry, terminal::AppError};
use belfry_protocol::inbox::*;
fn conflict(text: &str) -> AppError {
    AppError::conflict(text)
}

pub(super) fn prepare(
    data: &mut Data,
    sources: &Snapshot,
    registry: &SessionRegistry,
    request: &PrepareRequest,
    at: i64,
) -> Result<PrepareResult, AppError> {
    if !data.enabled {
        return Err(conflict("The collaboration inbox has not been activated"));
    }
    if request.operation_id.is_empty() || request.operation_id.len() > 128 {
        return Err(AppError::invalid_argument("Invalid prepare operation ID"));
    }
    let operation = format!("prepare:{}:{}", request.session_key, request.operation_id);
    let signature = operation_hash(request);
    if let Some(batch) = data.batches.values().find(|batch| batch.operation_id == operation) {
        if batch.operation_hash != signature {
            return Err(conflict("Prepare operation ID was used with different input"));
        }
        return Ok(PrepareResult { batch: Some(batch.view.clone()), blocker: None });
    }
    let expired: Vec<_> = data
        .batches
        .values()
        .filter(|batch| batch.view.phase == "prepared" && batch.view.lease_expires_at <= at)
        .map(|batch| batch.view.id.clone())
        .collect();
    for id in expired {
        abort(data, &id);
    }
    let blocked = |code: Status| Ok(PrepareResult { batch: None, blocker: Some(code) });
    if let Some(batch) = data.batches.values().find(|batch| {
        batch.view.recipient.session_key == request.session_key
            && matches!(batch.view.phase.as_str(), "prepared" | "submitting" | "uncertain")
    }) {
        return blocked(Status::new(&batch.view.phase).with("batchId", &batch.view.id));
    }
    let mut candidates: Vec<_> = data
        .entries
        .values()
        .filter(|entry| {
            entry.view.recipient.session_key == request.session_key
                && entry.view.delivery_phase == DeliveryPhase::Pending
                && entry.view.class != MessageClass::Fyi
                && read::blocker(entry, data, sources, registry, at, true).is_none()
        })
        .cloned()
        .collect();
    if candidates.is_empty() {
        let mut pending: Vec<_> = data
            .entries
            .values()
            .filter(|e| {
                e.view.recipient.session_key == request.session_key
                    && e.view.delivery_phase == DeliveryPhase::Pending
                    && e.view.class != MessageClass::Fyi
            })
            .collect();
        pending.sort_by_key(|entry| entry.enqueue_seq);
        return blocked(
            pending
                .first()
                .and_then(|e| read::blocker(e, data, sources, registry, at, true))
                .unwrap_or_else(|| Status::new("empty")),
        );
    }
    let priority = |entry: &Entry| -> u8 {
        if data
            .waits
            .get(&request.session_key)
            .is_some_and(|wait| entry.answers.iter().any(|answer| wait.questions.contains(answer)))
        {
            0
        } else if data.policies.get(&policy_key(entry)).is_some_and(|policy| policy.high) {
            1
        } else {
            2
        }
    };
    let force_normal = data.priority_streak.get(&request.session_key).copied().unwrap_or(0) >= 2
        && candidates.iter().any(|entry| priority(entry) == 2);
    candidates.sort_by_key(|entry| {
        (if force_normal { if priority(entry) == 2 { 0 } else { 1 } } else { priority(entry) }, entry.enqueue_seq)
    });
    let anchor = candidates.remove(0);
    if anchor.view.recipient.tab_id != request.offer.binding.tab_id {
        return Err(conflict("Input offer belongs to another recipient"));
    }
    let same_topic = |entry: &&Entry| {
        entry.view.recipient.id == anchor.view.recipient.id
            && entry.view.source.room_id == anchor.view.source.room_id
            && entry.view.source.kind == anchor.view.source.kind
            && entry.view.topic_id == anchor.view.topic_id
    };
    let related: Vec<_> = data
        .entries
        .values()
        .filter(same_topic)
        .filter(|entry| {
            entry.view.delivery_phase == DeliveryPhase::Pending
                && read::blocker(entry, data, sources, registry, at, true).is_none()
        })
        .collect();
    if anchor.view.class != MessageClass::TaskAssignment {
        let oldest = related.iter().map(|entry| entry.received_at).min().unwrap_or(at);
        let latest = related.iter().map(|entry| entry.received_at).max().unwrap_or(at);
        if at < (oldest + 5_000).min(latest + 2_500) {
            return blocked(Status::new("collecting"));
        }
    }
    let batch_id = new_id();
    let mut selected = vec![anchor.clone()];
    let mut mode = "full";
    let mut body = payload(&batch_id, &selected, false);
    if body.len() > MAX_BATCH_BYTES || anchor.view.questions.len() > MAX_BATCH_QUESTIONS {
        mode = "reference";
        body = payload(&batch_id, &selected, true);
    }
    if body.len() > MAX_BATCH_BYTES {
        return blocked(Status::new("capacity_exceeded"));
    }
    if mode == "full" && anchor.view.class != MessageClass::TaskAssignment {
        let mut extra: Vec<_> = related
            .into_iter()
            .filter(|entry| {
                entry.view.id != anchor.view.id
                    && entry.view.class != MessageClass::TaskAssignment
                    && !(entry.view.class == MessageClass::Fyi && entry.handling == Handling::Processed)
            })
            .cloned()
            .collect();
        extra.sort_by_key(|entry| entry.enqueue_seq);
        for entry in extra {
            if selected.len() >= MAX_BATCH_MESSAGES {
                break;
            }
            let mut next = selected.clone();
            next.push(entry);
            next.sort_by_key(|entry| entry.enqueue_seq);
            if next.iter().map(|entry| entry.view.questions.len()).sum::<usize>() > MAX_BATCH_QUESTIONS {
                break;
            }
            let proposed = payload(&batch_id, &next, false);
            if proposed.len() > MAX_BATCH_BYTES {
                break;
            }
            selected = next;
            body = proposed;
        }
    }
    let view = BatchView {
        id: batch_id.clone(),
        attempt_id: new_id(),
        revision: 1,
        sequence: 0,
        recipient: anchor.view.recipient.clone(),
        target_epoch: request.offer.binding.target_epoch.clone(),
        terminal_session_id: request.offer.binding.terminal_session_id.clone(),
        topic_id: anchor.view.topic_id.clone(),
        entry_ids: selected.iter().map(|entry| entry.view.id.clone()).collect(),
        message_ids: selected.iter().map(|entry| entry.view.message_id.clone()).collect(),
        payload_hash: hash(&body),
        payload: body,
        content_mode: mode.into(),
        phase: "prepared".into(),
        prepared_at: at,
        lease_expires_at: request.offer.expires_at,
    };
    let priority = priority(&anchor) != 2;
    for id in &view.entry_ids {
        let entry = data.entries.get_mut(id).unwrap();
        entry.view.delivery_phase = DeliveryPhase::Prepared;
        entry.view.revision += 1;
        entry.batch_id = Some(batch_id.clone());
    }
    data.batches.insert(
        batch_id,
        Batch {
            view: view.clone(),
            offer: Some(request.offer.clone()),
            operation_id: operation,
            operation_hash: signature,
            priority,
            receipt_hash: None,
        },
    );
    Ok(PrepareResult { batch: Some(view), blocker: None })
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn payload(batch_id: &str, entries: &[Entry], reference: bool) -> String {
    let first = &entries[0];
    let mut text =
        format!("[belfry inbox] {}\nBatch: {batch_id}\nTopic: {}\n", first.view.source.name, first.view.topic_id);
    for entry in entries {
        text.push_str(&format!("\n[{}] {}\n", entry.view.message_id, entry.view.by.name));
        if let Some(reply) = &entry.view.reply_to {
            text.push_str(&format!("Reply to: {reply}\n"));
        }
        if !entry.answers.is_empty() {
            text.push_str(&format!("Answers: {}\n", entry.answers.join(", ")));
        }
        if reference {
            text.push_str(&format!(
                "{}\nFull message (read before acting): belfry inbox read {}\n",
                crate::rooms::model::excerpt(&entry.view.text, 300),
                entry.view.message_id
            ));
        } else {
            text.push_str(&entry.view.text);
            text.push('\n');
            for attachment in &entry.view.attachments {
                text.push_str(&format!("Attachment {}: {}\n", attachment.name, attachment.path));
            }
        }
        for question in &entry.view.questions {
            if question.state == "open" {
                text.push_str(&format!(
                    "Question {}: {}\n",
                    question.id,
                    if reference { "see full message" } else { &question.text }
                ));
            }
        }
        if let Some(task) = &entry.task {
            if task.kind == "direct_task" {
                text.push_str(&format!(
                    "Report completion: belfry done {} <result>\n",
                    crate::collab::task::short_id(&task.id)
                ));
            } else {
                text.push_str(&format!(
                    "Report completion: belfry room task done {} --room {} --generation {} <result>\n",
                    task.id,
                    quote(&entry.view.source.name),
                    task.generation
                ));
            }
        }
    }
    if first.view.source.kind == "room" {
        text.push_str(&format!("\nFor discussion: belfry room say --room {} --topic {} <text>. Add --answer <questionId> for each question answered. Replying to questions does not complete a task. No acknowledgement reply is required.\n", quote(&first.view.source.name), quote(&first.view.topic_id)));
    }
    // Control bytes remain readable in source storage, but cannot terminate the native paste frame.
    text.chars()
        .map(|ch| {
            if ch.is_control() && !matches!(ch, '\n' | '\r' | '\t') {
                format!("\\u{{{:04x}}}", ch as u32)
            } else {
                ch.to_string()
            }
        })
        .collect()
}

/// Errors are returned inside the transaction result so an invalid prepared lease can be durably aborted.
pub(super) fn begin(
    data: &mut Data,
    sources: &Snapshot,
    registry: &SessionRegistry,
    request: &BeginRequest,
    at: i64,
    input_valid: bool,
) -> Result<BatchView, AppError> {
    let current = data.batches.get(&request.batch.batch_id).ok_or_else(|| conflict("Batch was not found"))?.clone();
    cas(&current.view, &request.batch)?;
    if current.view.phase != "prepared" {
        return Err(conflict("Batch already crossed the submission boundary; do not send its payload again"));
    }
    if current.offer.as_ref().is_none_or(|offer| operation_hash(offer) != operation_hash(&request.offer))
        || current.view.lease_expires_at <= at
        || !input_valid
    {
        abort(data, &current.view.id);
        return Err(conflict("Input reservation expired or changed; prepared batch was aborted"));
    }
    for id in &current.view.entry_ids {
        let valid = data.entries.get(id).is_some_and(|entry| {
            entry.view.delivery_phase == DeliveryPhase::Prepared
                && read::blocker(entry, data, sources, registry, at, true).is_none()
        });
        if !valid {
            abort(data, &current.view.id);
            return Err(conflict("Source, policy or target changed; prepared batch was aborted"));
        }
    }
    set_phase(data, &current.view.id, "submitting");
    let batch = data.batches.get_mut(&current.view.id).unwrap();
    batch.view.sequence += 1;
    for id in &batch.view.entry_ids {
        if let Some(entry) = data.entries.get(id)
            && let Some(task) = &entry.task
        {
            let slots = data.slots.entry(entry.view.recipient.session_key.clone()).or_default();
            if !slots.contains(task) {
                slots.push(task.clone());
            }
        }
    }
    let streak = data.priority_streak.entry(batch.view.recipient.session_key.clone()).or_default();
    *streak = if batch.priority { streak.saturating_add(1) } else { 0 };
    Ok(batch.view.clone())
}
pub(super) fn cas(view: &BatchView, request: &BatchRequest) -> Result<(), AppError> {
    if view.id != request.batch_id
        || view.attempt_id != request.attempt_id
        || view.revision != request.expected_revision
    {
        Err(conflict("Batch changed; read the current batch before acting"))
    } else {
        Ok(())
    }
}
pub(super) fn receipt(
    data: &mut Data,
    request: &ReceiptRequest,
    native_evidence: bool,
    never_pasted: bool,
) -> Result<BatchView, AppError> {
    if !matches!(request.phase.as_str(), "submitted" | "uncertain")
        || request.message.as_ref().is_some_and(|m| m.len() > 4096)
    {
        return Err(AppError::invalid_argument("Invalid delivery receipt"));
    }
    let current = data.batches.get(&request.batch_id).ok_or_else(|| conflict("Batch was not found"))?.clone();
    if current.view.attempt_id != request.attempt_id || current.view.payload_hash != request.payload_hash {
        return Err(conflict("Receipt does not match the frozen attempt"));
    }
    let signature = operation_hash(request);
    if request.sequence == current.view.sequence && current.receipt_hash.as_deref() == Some(&signature) {
        return Ok(current.view);
    }
    if request.sequence != current.view.sequence + 1
        || !matches!(current.view.phase.as_str(), "submitting" | "uncertain")
    {
        return Err(conflict("Receipt sequence or phase is stale"));
    }
    if request.phase == "submitted" && !native_evidence {
        return Err(conflict("Submitted requires successful guarded payload and submit-key writes from this attempt"));
    }
    if request.phase == "uncertain" && never_pasted && current.view.phase == "submitting" {
        requeue(data, &request.batch_id);
    } else {
        set_phase(data, &request.batch_id, &request.phase);
    }
    let batch = data.batches.get_mut(&request.batch_id).unwrap();
    batch.view.sequence = request.sequence;
    batch.receipt_hash = Some(signature);
    Ok(batch.view.clone())
}
pub(super) fn resolve(data: &mut Data, request: &ResolveRequest) -> Result<BatchView, AppError> {
    let current = data.batches.get(&request.batch.batch_id).ok_or_else(|| conflict("Batch was not found"))?.clone();
    cas(&current.view, &request.batch)?;
    if current.view.phase != "uncertain" || request.sequence != current.view.sequence {
        return Err(conflict("Only the current uncertain attempt can be resolved"));
    }
    let phase = match request.decision.as_str() {
        "submitted" => "submitted",
        "abandon" => "abandoned",
        _ => return Err(AppError::invalid_argument("Decision must be submitted or abandon")),
    };
    set_phase(data, &current.view.id, phase);
    let batch = data.batches.get_mut(&current.view.id).unwrap();
    batch.view.sequence += 1;
    Ok(batch.view.clone())
}
