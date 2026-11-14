//! Native ownership and input-generation fence for automatic prompt and inbox delivery.
use super::AppError;
use belfry_protocol::inbox::{BindRequest, Binding, Offer, OfferRequest, WriteGuard};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

const OFFER_MS: i64 = 5_000;
const MAX_WRITES: usize = 64;
const MAX_WRITE_BYTES: usize = belfry_protocol::inbox::MAX_BATCH_BYTES * 2 + 64;
const WRITE_LEASE: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteEvidence {
    /// At least one guarded write reached (or may have reached) the PTY.
    pub touched: bool,
    /// The whole frozen bracketed payload was written without error.
    pub paste_complete: bool,
}

#[derive(Default)]
pub(crate) struct InputGate {
    revision: AtomicU64,
    inner: Mutex<HashMap<String, Channel>>,
    modes: Mutex<HashMap<String, super::input_gate_vt::Modes>>,
}
struct Channel {
    tab_id: Option<String>,
    cwd: PathBuf,
    live: bool,
    owner: Option<String>,
    epoch: String,
    revision: u64,
    seen_offers: HashSet<String>,
    offer: Option<Offer>,
    attempt: Option<Attempt>,
    protocol_agent: Option<crate::agent::AgentKind>,
    last_submission: u64,
    input_dirty: bool,
    submission_revision: Option<(u64, u64)>,
    blocked_input: Option<(u64, bool)>,
}
struct Attempt {
    direct_prompt: bool,
    protocol_sequence: Option<u64>,
    deadline: Instant,
    frames: Vec<Vec<u8>>,
    pasted: Vec<u8>,
    paste_complete: bool,
    offer_id: String,
    guard: WriteGuard,
    revoked: bool,
    writes: BTreeMap<u64, Written>,
    bytes: usize,
}
struct Written {
    hash: Vec<u8>,
    error: Option<AppError>,
    touched: bool,
    submit_key: bool,
}

fn conflict(message: &str) -> AppError {
    AppError::conflict(message)
}
fn submit_key(bytes: &[u8]) -> bool {
    matches!(bytes, b"\r" | b"\n" | b"\r\n" | b"\x1b[13u" | b"\x1b[13;1u")
}
fn same_binding(channel: &Channel, binding: &Binding) -> bool {
    channel.live
        && channel.tab_id.as_deref() == Some(&binding.tab_id)
        && channel.owner.as_deref() == Some(&binding.owner_id)
        && channel.epoch == binding.target_epoch
        && channel.revision == binding.input_revision
}
fn editor_empty(channel: &Channel, mode: Option<&super::input_gate_vt::Modes>) -> bool {
    let acknowledged = channel.submission_revision.is_some_and(|(revision, sequence)| {
        revision == channel.revision && mode.is_some_and(|mode| mode.working_agent == channel.protocol_agent
            && mode.working_sequence > sequence)
    });
    channel.protocol_agent.is_none() || !channel.input_dirty || acknowledged
}
fn protocol_ready(channel: &Channel, mode: Option<&super::input_gate_vt::Modes>) -> bool {
    protocol_idle(channel, mode) && editor_empty(channel, mode)
}
fn protocol_idle(channel: &Channel, mode: Option<&super::input_gate_vt::Modes>) -> bool {
    channel.protocol_agent.is_none_or(|agent| mode.and_then(|mode| mode.protocol.as_ref()).is_some_and(|snapshot| {
        snapshot.terminal_status_for(agent).is_some_and(|report| report.state.allows_input())
            && snapshot.sequence > channel.last_submission
    }))
}

fn payload_frames(payload: &str) -> Result<Vec<Vec<u8>>, AppError> {
    if payload.is_empty() || payload.len() > belfry_protocol::inbox::MAX_BATCH_BYTES
        || payload.contains("\x1b[201~") || payload.contains('\0')
    {
        return Err(conflict("Frozen payload cannot be safely pasted"));
    }
    let normalized = payload.replace("\r\n", "\n").replace('\r', "\n");
    let mut frames: Vec<_> = [normalized.clone(), normalized.replace('\n', "\r"), normalized.replace('\n', "\r\n")]
        .iter().map(|text| format!("\x1b[200~{text}\x1b[201~").into_bytes()).collect();
    frames.sort();
    frames.dedup();
    Ok(frames)
}

impl InputGate {
    pub fn revision(&self) -> u64 {
        self.revision.load(Ordering::Acquire)
    }
    pub fn register(&self, id: &str, tab_id: Option<String>, cwd: PathBuf) {
        let cwd = crate::resource::canonicalize(&cwd).unwrap_or(cwd);
        if let Ok(mut channels) = self.inner.lock() {
            if let Some(existing) = channels.get_mut(id) {
                if existing.tab_id == tab_id && existing.cwd == cwd && existing.live {
                    return;
                }
            }
            self.revision.fetch_add(1, Ordering::Release);
            channels.insert(
                id.into(),
                Channel {
                    tab_id,
                    cwd,
                    live: true,
                    owner: None,
                    epoch: ulid::Ulid::generate().to_string(),
                    revision: 0,
                    seen_offers: HashSet::new(),
                    offer: None,
                    attempt: None,
                    protocol_agent: None,
                    last_submission: 0,
                    input_dirty: false,
                    submission_revision: None,
                    blocked_input: None,
                },
            );
        }
    }

    pub fn require_protocol(&self, id: &str, agent: crate::agent::AgentKind, reconnected: bool) {
        if let Ok(mut channels) = self.inner.lock() && let Some(channel) = channels.get_mut(id) {
            if channel.protocol_agent.is_none() {
                channel.protocol_agent = Some(agent);
                channel.input_dirty |= reconnected;
                self.revision.fetch_add(1, Ordering::Release);
            }
        }
    }

    /// Genuine editor intent includes IME and paste before either produces PTY bytes.
    pub fn claim_user_input(&self, id: &str) -> Result<(), AppError> {
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        let modes = self.modes.lock().map_err(|_| conflict("Terminal mode registry is unavailable"))?;
        let channel = channels.get_mut(id).filter(|channel| channel.live).ok_or_else(AppError::process_exited)?;
        let mode = modes.get(id);
        if channel.protocol_agent.is_some_and(|agent| mode.and_then(|mode| mode.protocol.as_ref())
            .and_then(|snapshot| snapshot.terminal_status_for(agent)).is_some_and(|report| report.state == crate::agent::ProgramState::Blocked))
        {
            let sequence = mode.unwrap().blocked_sequence;
            if channel.blocked_input.is_none_or(|(old, _)| old != sequence) {
                channel.blocked_input = Some((sequence, editor_empty(channel, mode)));
            }
        }
        channel.revision = channel.revision.checked_add(1).ok_or_else(|| conflict("Input revision overflow"))?;
        channel.input_dirty |= channel.protocol_agent.is_some();
        channel.submission_revision = None;
        channel.offer = None;
        if let Some(attempt) = &mut channel.attempt { attempt.revoked = true; }
        self.revision.fetch_add(1, Ordering::Release);
        Ok(())
    }

    /// Foreground prompt queues share the same frozen-write fence as inbox delivery.
    pub fn prepare_prompt(&self, id: &str, payload: &str) -> Result<WriteGuard, AppError> {
        let frames = payload_frames(payload)?;
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        let modes = self.modes.lock().map_err(|_| conflict("Terminal mode registry is unavailable"))?;
        let channel = channels.get_mut(id).filter(|channel| channel.live).ok_or_else(AppError::process_exited)?;
        if channel.protocol_agent.is_none() || !protocol_ready(channel, modes.get(id))
            || !modes.get(id).is_some_and(|mode| mode.bracketed_paste)
        {
            return Err(conflict("Waiting for an available terminal status and input position (OSC 7501)"));
        }
        if channel.attempt.as_ref().is_some_and(|attempt| attempt.direct_prompt && (attempt.revoked || Instant::now() >= attempt.deadline)) {
            channel.attempt = None;
        }
        if channel.attempt.is_some() { return Err(conflict("Another automatic input is already authorized")); }
        let guard = WriteGuard {
            batch_id: ulid::Ulid::generate().to_string(), attempt_id: ulid::Ulid::generate().to_string(),
            token: ulid::Ulid::generate().to_string(), owner_id: channel.owner.get_or_insert_with(|| "prompt".into()).clone(),
            target_epoch: channel.epoch.clone(), input_revision: channel.revision,
        };
        channel.offer = None;
        channel.attempt = Some(Attempt {
            direct_prompt: true,
            protocol_sequence: modes.get(id).and_then(|mode| mode.protocol.as_ref()).map(|snapshot| snapshot.sequence),
            deadline: Instant::now() + WRITE_LEASE, frames, pasted: Vec::new(), paste_complete: false,
            offer_id: String::new(), guard: guard.clone(), revoked: false, writes: BTreeMap::new(), bytes: 0,
        });
        self.revision.fetch_add(1, Ordering::Release);
        Ok(guard)
    }

    pub fn finish_prompt(&self, id: &str, guard: &WriteGuard) -> Result<WriteEvidence, AppError> {
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        let channel = channels.get_mut(id).ok_or_else(AppError::process_exited)?;
        let attempt = channel.attempt.as_ref().filter(|attempt| attempt.direct_prompt && attempt.guard == *guard)
            .ok_or_else(|| conflict("The prompt input guard is no longer held"))?;
        let evidence = WriteEvidence { touched: attempt.writes.values().any(|write| write.touched), paste_complete: attempt.paste_complete
            && attempt.writes.values().all(|write| write.error.is_none() || write.submit_key) };
        channel.attempt = None;
        self.revision.fetch_add(1, Ordering::Release);
        Ok(evidence)
    }

    pub fn observe_agent_state(&self, id: &str, snapshot: &crate::agent::hooks::HookSnapshot) {
        let Some(report) = snapshot.terminal_status_for(snapshot.agent) else { return; };
        // Do not lock input ownership here: the PTY reader must drain output while
        // a large guarded write holds the input lock. Working acknowledgements
        // are reconciled against that input revision when readiness is checked.
        if let Ok(mut modes) = self.modes.lock() {
            let mode = modes.entry(id.into()).or_default();
            if mode.protocol.as_ref().is_none_or(|old| snapshot.sequence > old.sequence) {
                if report.state == crate::agent::ProgramState::Blocked && mode.protocol.as_ref()
                    .and_then(|old| old.terminal_status_for(snapshot.agent)).is_none_or(|old| old.state != crate::agent::ProgramState::Blocked)
                {
                    mode.blocked_sequence = snapshot.sequence;
                }
                if report.state == crate::agent::ProgramState::Working {
                    mode.working_sequence = snapshot.sequence;
                    mode.working_agent = Some(snapshot.agent);
                }
                mode.protocol = Some(snapshot.clone());
                self.revision.fetch_add(1, Ordering::Release);
            }
        }
    }

    fn protocol_ready(&self, id: &str) -> bool {
        let Ok(channels) = self.inner.lock() else { return false; };
        let Ok(modes) = self.modes.lock() else { return false; };
        channels.get(id).is_some_and(|channel| protocol_ready(channel, modes.get(id)))
    }

    pub fn retire(&self, id: &str) {
        if let Ok(mut channels) = self.inner.lock()
            && let Some(channel) = channels.get_mut(id)
        {
            self.revision.fetch_add(1, Ordering::Release);
            channel.live = false;
            channel.offer = None;
            channel.revision = channel.revision.saturating_add(1);
            if let Some(attempt) = &mut channel.attempt {
                attempt.revoked = true;
            }
        }
    }

    pub fn retire_tab(&self, tab: &str) {
        let ids: Vec<_> = self
            .inner
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, channel)| channel.tab_id.as_deref() == Some(tab))
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            self.retire(&id);
        }
    }
    pub fn retire_all(&self) {
        let ids: Vec<_> = self.inner.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.retire(&id);
        }
    }

    pub fn bind(&self, request: &BindRequest, project_root: &std::path::Path) -> Result<Binding, AppError> {
        let project_root = crate::resource::canonicalize(project_root).unwrap_or_else(|_| project_root.to_owned());
        if request.owner_id.is_empty() || request.owner_id.len() > 128 {
            return Err(AppError::invalid_argument("Invalid inbox owner ID"));
        }
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        let channel = channels.get_mut(&request.terminal_session_id).ok_or_else(AppError::process_exited)?;
        if !channel.live
            || channel.tab_id.as_deref() != Some(&request.tab_id)
            || !channel.cwd.starts_with(&project_root)
        {
            return Err(conflict("The terminal no longer belongs to this inbox target"));
        }
        if channel.owner.as_deref() != Some(&request.owner_id) {
            channel.owner = Some(request.owner_id.clone());
            channel.epoch = ulid::Ulid::generate().to_string();
            channel.offer = None;
            channel.seen_offers.clear();
            if let Some(attempt) = &mut channel.attempt {
                attempt.revoked = true;
            }
        }
        Ok(Binding {
            tab_id: request.tab_id.clone(),
            terminal_session_id: request.terminal_session_id.clone(),
            owner_id: request.owner_id.clone(),
            target_epoch: channel.epoch.clone(),
            input_revision: channel.revision,
        })
    }

    pub fn owns_project(&self, binding: &Binding, root: &std::path::Path) -> bool {
        self.inner.lock().ok().is_some_and(|channels| {
            channels
                .get(&binding.terminal_session_id)
                .is_some_and(|channel| same_binding(channel, binding) && channel.cwd.starts_with(root))
        })
    }

    pub fn observe_output(&self, session: &str, sequence: u64, bytes: &[u8]) {
        if let Ok(mut modes) = self.modes.lock() {
            let mode = modes.entry(session.into()).or_default();
            let before = mode.bracketed_paste;
            mode.observe(sequence, bytes, crate::rooms::model::now_millis());
            if before != mode.bracketed_paste {
                self.revision.fetch_add(1, Ordering::Release);
            }
        }
    }
    pub fn output_gap(&self, session: &str) {
        self.revision.fetch_add(1, Ordering::Release);
        if let Ok(mut modes) = self.modes.lock() {
            modes.entry(session.into()).or_default().reset();
        }
        if let Ok(mut channels) = self.inner.lock()
            && let Some(channel) = channels.get_mut(session)
        {
            channel.revision = channel.revision.saturating_add(1);
            channel.input_dirty |= channel.protocol_agent.is_some();
            channel.submission_revision = None;
            channel.blocked_input = None;
            channel.offer = None;
            if let Some(attempt) = &mut channel.attempt {
                attempt.revoked = true;
            }
        }
    }
    pub fn ready_tab(&self, tab: &str) -> bool {
        let Ok(channels) = self.inner.lock() else {
            return false;
        };
        let Ok(modes) = self.modes.lock() else {
            return false;
        };
        channels.iter().any(|(id, channel)| {
            channel.live
                && channel.tab_id.as_deref() == Some(tab)
                && modes.get(id).is_some_and(|mode| mode.bracketed_paste)
                && protocol_ready(channel, modes.get(id))
        })
    }
    pub fn safe_paste(&self, session: &str) -> bool {
        self.modes.lock().ok().is_some_and(|modes| modes.get(session).is_some_and(|mode| mode.bracketed_paste))
    }

    pub fn offer(&self, request: &OfferRequest, now: i64) -> Result<Offer, AppError> {
        if !self.protocol_ready(&request.binding.terminal_session_id) {
            return Err(conflict("Waiting for an available terminal status and input position (OSC 7501)"));
        }
        if !self.safe_paste(&request.binding.terminal_session_id) {
            return Err(conflict("Bracketed paste mode is not enabled at this terminal input position"));
        }
        if !request.running
            || !request.idle
            || !request.composer_empty
            || request.awaiting_input
            || !request.prompt_queue_empty
        {
            return Err(conflict("The terminal input position is not ready"));
        }
        if request.offer_id.is_empty() || request.offer_id.len() > 128 {
            return Err(AppError::invalid_argument("Invalid inbox offer ID"));
        }
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        let channel = channels.get_mut(&request.binding.terminal_session_id).ok_or_else(AppError::process_exited)?;
        if !same_binding(channel, &request.binding) || channel.attempt.is_some() {
            return Err(conflict("The inbox input generation has changed"));
        }
        if let Some(offer) = &channel.offer
            && offer.offer_id == request.offer_id
        {
            if offer.expires_at <= now {
                return Err(conflict("The input offer expired; use a new offer ID"));
            }
            return Ok(offer.clone());
        }
        if !channel.seen_offers.insert(request.offer_id.clone()) {
            return Err(conflict("A revoked offer ID cannot be reused"));
        }
        let offer =
            Offer { binding: request.binding.clone(), offer_id: request.offer_id.clone(), expires_at: now + OFFER_MS };
        channel.offer = Some(offer.clone());
        Ok(offer)
    }

    pub fn check(&self, offer: &Offer, now: i64) -> bool {
        if !self.protocol_ready(&offer.binding.terminal_session_id) { return false; }
        if !self.safe_paste(&offer.binding.terminal_session_id) {
            return false;
        }
        let Ok(channels) = self.inner.lock() else {
            return false;
        };
        channels.get(&offer.binding.terminal_session_id).is_some_and(|channel| {
            same_binding(channel, &offer.binding)
                && channel.attempt.is_none()
                && channel.offer.as_ref().is_some_and(|current| {
                    current.offer_id == offer.offer_id
                        && current.expires_at == offer.expires_at
                        && current.expires_at > now
                })
        })
    }

    pub fn revoke(&self, offer: &Offer) {
        if let Ok(mut channels) = self.inner.lock()
            && let Some(channel) = channels.get_mut(&offer.binding.terminal_session_id)
            && channel.owner.as_deref() == Some(&offer.binding.owner_id)
            && channel.epoch == offer.binding.target_epoch
        {
            if channel.offer.as_ref().is_some_and(|current| current.offer_id == offer.offer_id) {
                channel.offer = None;
            }
            if let Some(attempt) = &mut channel.attempt
                && attempt.offer_id == offer.offer_id
            {
                attempt.revoked = true;
            }
        }
    }

    /// Only called after the durable submitting intent committed.
    pub fn authorize(
        &self,
        offer: &Offer,
        batch: &str,
        attempt: &str,
        payload: &str,
        now: i64,
    ) -> Result<WriteGuard, AppError> {
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        let modes = self.modes.lock().map_err(|_| conflict("Terminal mode registry is unavailable"))?;
        if !modes.get(&offer.binding.terminal_session_id).is_some_and(|mode| mode.bracketed_paste) {
            return Err(conflict("Safe multi-line paste is not enabled"));
        }
        let frames = payload_frames(payload)?;
        let channel = channels.get_mut(&offer.binding.terminal_session_id).ok_or_else(AppError::process_exited)?;
        if !protocol_ready(channel, modes.get(&offer.binding.terminal_session_id)) {
            return Err(conflict("The agent is not idle according to its terminal protocol"));
        }
        if !same_binding(channel, &offer.binding)
            || channel.attempt.is_some()
            || !channel.offer.as_ref().is_some_and(|current| {
                current.offer_id == offer.offer_id && current.expires_at == offer.expires_at && current.expires_at > now
            })
        {
            return Err(conflict("The input offer changed after the delivery intent"));
        }
        let guard = WriteGuard {
            batch_id: batch.into(),
            attempt_id: attempt.into(),
            token: ulid::Ulid::generate().to_string(),
            owner_id: offer.binding.owner_id.clone(),
            target_epoch: offer.binding.target_epoch.clone(),
            input_revision: channel.revision,
        };
        channel.offer = None;
        channel.attempt = Some(Attempt {
            direct_prompt: false,
            protocol_sequence: channel.protocol_agent.map(|_| modes.get(&offer.binding.terminal_session_id)
                .and_then(|mode| mode.protocol.as_ref()).map_or(0, |snapshot| snapshot.sequence)),
            deadline: Instant::now() + WRITE_LEASE,
            frames,
            pasted: Vec::new(),
            paste_complete: false,
            offer_id: offer.offer_id.clone(),
            guard: guard.clone(),
            revoked: false,
            writes: BTreeMap::new(),
            bytes: 0,
        });
        Ok(guard)
    }

    /// Ordinary input owns the next position. It never borrows an automatic write token.
    pub fn user_write(
        &self,
        session: &str,
        bytes: &[u8],
        write: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        let mut modes = self.modes.lock().map_err(|_| conflict("Terminal mode registry is unavailable"))?;
        // Focus reports (DECSET 1004) are emitted by xterm on window/tab focus changes. They never edit the
        // input line, so they must not revoke an in-flight automatic paste.
        let protocol_response = matches!(bytes, b"\x1b[I" | b"\x1b[O")
            || modes.get_mut(session).is_some_and(|mode| mode.response(bytes, crate::rooms::model::now_millis()));
        let status_sequence = modes.get(session).and_then(|mode| mode.protocol.as_ref()).map_or(0, |snapshot| snapshot.sequence);
        let status_agent = modes.get(session).and_then(|mode| mode.protocol.as_ref()).map(|snapshot| snapshot.agent);
        let status_idle = modes.get(session).and_then(|mode| mode.protocol.as_ref())
            .is_some_and(|snapshot| snapshot.terminal_status_for(snapshot.agent).is_some_and(|report| report.state.allows_input()));
        let dialog = channels.get(session).and_then(|channel| {
            let mode = modes.get(session)?;
            let report = mode.protocol.as_ref()?.terminal_status_for(channel.protocol_agent?)?;
            (report.state == crate::agent::ProgramState::Blocked).then_some((mode.blocked_sequence, editor_empty(channel, Some(mode))))
        });
        // Keep input ownership through the write, but let the output reader drain
        // the PTY while its child is still reading a large input frame.
        drop(modes);
        if !bytes.is_empty()
            && !protocol_response
            && let Some(channel) = channels.get_mut(session)
        {
            if let Some((sequence, empty)) = dialog && channel.blocked_input.is_none_or(|(old, _)| old != sequence) {
                // Dialog input may be released after an answer, but an earlier composer draft stays owned.
                channel.blocked_input = Some((sequence, empty));
            }
            channel.revision = channel.revision.checked_add(1).ok_or_else(|| conflict("Input revision overflow"))?;
            if channel.protocol_agent.is_some() {
                channel.input_dirty = true;
                let dialog_empty = dialog.is_some_and(|(sequence, _)| channel.blocked_input == Some((sequence, true)));
                channel.submission_revision = (submit_key(bytes) && (status_idle || dialog_empty) && status_agent == channel.protocol_agent)
                    .then_some((channel.revision, status_sequence));
            }
            self.revision.fetch_add(1, Ordering::Release);
            channel.offer = None;
            if let Some(attempt) = &mut channel.attempt {
                attempt.revoked = true;
            }
        }
        let result = write();
        if result.is_err() && let Some(channel) = channels.get_mut(session) {
            channel.submission_revision = None;
            if let Some((sequence, _)) = channel.blocked_input { channel.blocked_input = Some((sequence, false)); }
        }
        result
    }

    #[cfg(test)]
    pub fn guarded_write(
        &self,
        session: &str,
        guard: &WriteGuard,
        sequence: u64,
        bytes: &[u8],
        write: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        self.guarded_write_checked(session, guard, sequence, bytes, |_| write())
    }

    /// Reserve the write sequence before touching the PTY; uncertain writes are never retried.
    pub fn guarded_write_checked(
        &self,
        session: &str,
        guard: &WriteGuard,
        sequence: u64,
        bytes: &[u8],
        write: impl FnOnce(Option<u64>) -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        let modes = self.modes.lock().map_err(|_| conflict("Terminal mode registry is unavailable"))?;
        let channel = channels.get_mut(session).ok_or_else(AppError::process_exited)?;
        let ready = protocol_idle(channel, modes.get(session));
        if !channel.live
            || channel.epoch != guard.target_epoch
            || channel.owner.as_deref() != Some(&guard.owner_id)
            || channel.revision != guard.input_revision
        {
            return Err(conflict("The automatic input guard is no longer valid"));
        }
        let attempt = channel.attempt.as_mut().ok_or_else(|| conflict("No automatic input is authorized"))?;
        if attempt.guard != *guard {
            return Err(conflict("The automatic input was interrupted"));
        }
        let hash = Sha256::digest(bytes).to_vec();
        if let Some(previous) = attempt.writes.get(&sequence) {
            if previous.hash != hash {
                return Err(conflict("A write sequence cannot be reused with different bytes"));
            }
            return previous.error.as_ref().map_or(Ok(()), |error| Err(error.clone()));
        }
        if !ready || attempt.protocol_sequence.is_some_and(|expected| {
            modes.get(session).and_then(|mode| mode.protocol.as_ref()).is_none_or(|snapshot| snapshot.sequence != expected)
        }) {
            return Err(conflict("Agent terminal status changed before automatic input"));
        }
        if Instant::now() >= attempt.deadline {
            attempt.revoked = true;
            return Err(conflict("The automatic write lease expired"));
        }
        if attempt.revoked || attempt.writes.last_key_value().is_some_and(|(_, write)| write.submit_key) {
            return Err(conflict("The automatic input was interrupted or already submitted"));
        }
        if sequence != attempt.writes.len() as u64 + 1
            || attempt.writes.len() >= MAX_WRITES
            || bytes.is_empty()
            || attempt.bytes.saturating_add(bytes.len()) > MAX_WRITE_BYTES
        {
            return Err(conflict("Invalid or oversized automatic write sequence"));
        }
        if !modes.get(session).is_some_and(|mode| mode.bracketed_paste) {
            return Err(conflict("Bracketed paste mode changed before automatic input"));
        }
        let submit_key = attempt.paste_complete && submit_key(bytes);
        let previous_paste_length = attempt.pasted.len();
        let previous_paste_complete = attempt.paste_complete;
        if attempt.paste_complete {
            if !submit_key {
                return Err(conflict("The frozen payload is complete; only its submit key is allowed"));
            }
        } else {
            let mut pasted = attempt.pasted.clone();
            pasted.extend_from_slice(bytes);
            if !attempt.frames.iter().any(|frame| frame.starts_with(&pasted)) {
                return Err(conflict("Automatic bytes do not match the frozen bracketed payload"));
            }
            attempt.paste_complete = attempt.frames.iter().any(|frame| *frame == pasted);
            attempt.pasted = pasted;
        }
        attempt.bytes += bytes.len();
        attempt
            .writes
            .insert(sequence, Written { hash, error: Some(AppError::io("Automatic write result is uncertain")), touched: true, submit_key });
        let status_sequence = modes.get(session).and_then(|mode| mode.protocol.as_ref()).map_or(0, |s| s.sequence);
        drop(modes);
        let result = write(attempt.protocol_sequence);
        // These backend errors are explicit rejections before any PTY write. Network/IO
        // errors may be partial and must keep both the payload and editor reserved.
        let rejected = result.as_ref().err().is_some_and(|error| error.code == super::contracts::AppErrorCode::Conflict
            || error.code == super::contracts::AppErrorCode::ProcessExited);
        let written = attempt.writes.get_mut(&sequence).unwrap();
        written.error = result.as_ref().err().cloned();
        written.touched = !rejected;
        if rejected {
            attempt.pasted.truncate(previous_paste_length);
            attempt.paste_complete = previous_paste_complete;
            attempt.bytes -= bytes.len();
        } else {
            if submit_key { channel.last_submission = status_sequence; }
            if channel.protocol_agent.is_some() {
                channel.input_dirty = true;
                channel.submission_revision = (submit_key && result.is_ok()).then_some((channel.revision, status_sequence));
            }
        }
        if result.is_err() {
            attempt.revoked = true;
        }
        result
    }

    pub fn valid_attempt(&self, session: &str, batch: &str, epoch: &str) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|channels| {
                channels.get(session).map(|channel| {
                    channel.live
                        && channel.epoch == epoch
                        && channel.attempt.as_ref().is_some_and(|attempt| {
                            attempt.guard.batch_id == batch && !attempt.revoked && Instant::now() < attempt.deadline
                        })
                })
            })
            .unwrap_or(false)
    }
    pub fn has_written(&self, session: &str, batch: &str) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|channels| {
                channels.get(session).map(|channel| {
                    channel.attempt.as_ref().is_some_and(|attempt| {
                        attempt.guard.batch_id == batch
                            && !attempt.revoked
                            && attempt.paste_complete
                            && attempt.writes.len() >= 2
                            && attempt.writes.values().all(|write| write.error.is_none())
                            && attempt.writes.last_key_value().is_some_and(|(_, write)| write.submit_key)
                    })
                })
            })
            .unwrap_or(false)
    }
    /// What the native layer saw for this batch's current attempt. `None` means no attempt is held.
    pub fn written(&self, session: &str, batch: &str) -> Option<WriteEvidence> {
        let channels = self.inner.lock().ok()?;
        let attempt = channels.get(session)?.attempt.as_ref().filter(|attempt| attempt.guard.batch_id == batch)?;
        Some(WriteEvidence {
            touched: attempt.writes.values().any(|write| write.touched),
            paste_complete: attempt.paste_complete
                && attempt.writes.values().all(|write| write.error.is_none() || write.submit_key),
        })
    }
    pub fn finish(&self, session: &str, batch: &str) {
        if let Ok(mut channels) = self.inner.lock()
            && let Some(channel) = channels.get_mut(session)
            && channel.attempt.as_ref().is_some_and(|attempt| attempt.guard.batch_id == batch)
        {
            channel.attempt = None;
            channel.offer = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    fn ready() -> (InputGate, Offer) {
        let gate = InputGate::default();
        let root = std::env::temp_dir();
        gate.register("pty", Some("tab".into()), root.clone());
        gate.observe_output("pty", 1, b"\x1b[?2004h");
        let binding = gate
            .bind(
                &BindRequest { tab_id: "tab".into(), terminal_session_id: "pty".into(), owner_id: "owner".into() },
                &root,
            )
            .unwrap();
        let offer = gate
            .offer(
                &OfferRequest {
                    binding,
                    offer_id: "offer".into(),
                    running: true,
                    idle: true,
                    composer_empty: true,
                    awaiting_input: false,
                    prompt_queue_empty: true,
                },
                0,
            )
            .unwrap();
        (gate, offer)
    }
    #[test]
    fn input_and_owner_changes_fence_old_offers() {
        let (gate, offer) = ready();
        gate.user_write("pty", b"a", || Ok(())).unwrap();
        assert!(!gate.check(&offer, 1));
        assert!(gate.authorize(&offer, "batch", "attempt", "payload", 1).is_err());
        let (gate, offer) = ready();
        gate.bind(
            &BindRequest { tab_id: "tab".into(), terminal_session_id: "pty".into(), owner_id: "new-owner".into() },
            &std::env::temp_dir(),
        )
        .unwrap();
        assert!(!gate.check(&offer, 1));
    }
    #[test]
    fn revoked_offers_never_resurrect() {
        let (gate, offer) = ready();
        gate.revoke(&offer);
        assert!(
            gate.offer(
                &OfferRequest {
                    binding: offer.binding,
                    offer_id: offer.offer_id,
                    running: true,
                    idle: true,
                    composer_empty: true,
                    awaiting_input: false,
                    prompt_queue_empty: true
                },
                0
            )
            .is_err()
        );
    }
    #[test]
    fn writes_are_ordered_and_never_repeated() {
        let (gate, offer) = ready();
        let guard = gate.authorize(&offer, "batch", "attempt", "payload", 1).unwrap();
        let calls = Cell::new(0);
        let write = || {
            calls.set(calls.get() + 1);
            Ok(())
        };
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", write).unwrap();
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", write).unwrap();
        assert_eq!(calls.get(), 1);
        assert!(gate.guarded_write("pty", &guard, 1, b"different", write).is_err());
        assert!(gate.guarded_write("pty", &guard, 3, b"enter", write).is_err());
        gate.user_write("pty", b"user", || Ok(())).unwrap();
        assert!(gate.guarded_write("pty", &guard, 2, b"enter", write).is_err());
        assert_eq!(calls.get(), 1);
    }
    #[test]
    fn failed_native_write_cannot_retry_or_continue() {
        let (gate, offer) = ready();
        let guard = gate.authorize(&offer, "batch", "attempt", "payload", 1).unwrap();
        assert!(
            gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", || Err(AppError::io("lost reply")))
                .is_err()
        );
        assert!(gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", || panic!("retried PTY")).is_err());
        assert!(gate.guarded_write("pty", &guard, 2, b"enter", || panic!("continued uncertain write")).is_err());
        gate.retire("pty");
        assert!(!gate.valid_attempt("pty", "batch", &guard.target_epoch));
    }

    fn protocol(gate: &InputGate, agent: crate::agent::AgentKind, state: crate::agent::ProgramState, sequence: u64) {
        gate.observe_agent_state("pty", &crate::agent::hooks::HookSnapshot {
            sequence, state: state.lifecycle(), agent, session: None,
            source: crate::agent::AgentStateSource::TerminalProtocol, occurred_at: 0,
            reason: String::new(), transcript_path: None,
            program_status: Some(crate::agent::TerminalProgramStatus { state, kind: None, progress: None, title: None, message: None }),
        });
    }

    #[test]
    fn ordinary_prompts_and_inbox_share_one_native_input_position() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let (gate, offer) = ready();
            gate.require_protocol("pty", agent, false);
            assert!(gate.prepare_prompt("pty", "payload").is_err());
            protocol(&gate, agent, State::Idle, 1);
            let guard = gate.prepare_prompt("pty", "payload").unwrap();
            assert!(gate.prepare_prompt("pty", "another").is_err());
            assert!(gate.authorize(&offer, "inbox", "attempt", "payload", 1).is_err());
            for (sequence, bytes) in [(1, b"\x1b[200~payload\x1b[201~".as_slice()), (2, b"\r".as_slice())] {
                gate.guarded_write_checked("pty", &guard, sequence, bytes, |expected| {
                    assert_eq!(expected, Some(1));
                    Ok(())
                }).unwrap();
            }
            assert_eq!(gate.finish_prompt("pty", &guard).unwrap(), WriteEvidence { touched: true, paste_complete: true });
            assert!(gate.prepare_prompt("pty", "next").is_err());
            protocol(&gate, agent, State::Working, 2);
            protocol(&gate, agent, State::Done, 3);
            assert!(gate.prepare_prompt("pty", "next").is_ok());
        }
    }

    #[test]
    fn editor_intent_without_pty_bytes_revokes_an_automatic_prompt() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let (gate, _) = ready();
            gate.require_protocol("pty", agent, false);
            protocol(&gate, agent, State::Idle, 1);
            let guard = gate.prepare_prompt("pty", "payload").unwrap();
            gate.claim_user_input("pty").unwrap();
            assert!(gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", || panic!("overwrote IME input")).is_err());
            assert!(!gate.finish_prompt("pty", &guard).unwrap().touched);
            protocol(&gate, agent, State::Idle, 2);
            assert!(gate.prepare_prompt("pty", "next").is_err());
            gate.user_write("pty", b"\r", || Ok(())).unwrap();
            protocol(&gate, agent, State::Working, 3);
            protocol(&gate, agent, State::Idle, 4);
            assert!(gate.prepare_prompt("pty", "next").is_ok());
        }
    }

    #[test]
    fn dialog_editor_claims_preserve_a_draft_from_before_the_dialog() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            for draft in [false, true] {
                let (gate, _) = ready();
                gate.require_protocol("pty", agent, false);
                protocol(&gate, agent, State::Working, 1);
                if draft { gate.claim_user_input("pty").unwrap(); }
                protocol(&gate, agent, State::Blocked, 2);
                gate.claim_user_input("pty").unwrap();
                gate.user_write("pty", b"answer", || Ok(())).unwrap();
                gate.claim_user_input("pty").unwrap();
                gate.user_write("pty", b"\r", || Ok(())).unwrap();
                protocol(&gate, agent, State::Working, 3);
                protocol(&gate, agent, State::Idle, 4);
                assert_eq!(gate.ready_tab("tab"), !draft);
            }
        }
    }

    #[test]
    fn backend_status_rejection_is_zero_write_evidence_and_preserves_an_empty_editor() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let (gate, _) = ready();
            gate.require_protocol("pty", agent, false);
            protocol(&gate, agent, State::Idle, 1);
            let guard = gate.prepare_prompt("pty", "payload").unwrap();
            let bytes = b"\x1b[200~payload\x1b[201~";
            let error = gate.guarded_write_checked("pty", &guard, 1, bytes, |expected| {
                assert_eq!(expected, Some(1));
                Err(conflict("PTY has a newer blocked report"))
            }).unwrap_err();
            assert_eq!(error.code, super::super::contracts::AppErrorCode::Conflict);
            assert_eq!(gate.guarded_write("pty", &guard, 1, bytes, || panic!("repeated rejected write")).unwrap_err().code, error.code);
            assert_eq!(gate.finish_prompt("pty", &guard).unwrap(), WriteEvidence { touched: false, paste_complete: false });
            protocol(&gate, agent, State::Idle, 3);
            assert!(gate.prepare_prompt("pty", "next").is_ok());
        }
    }

    #[test]
    fn backend_rejection_after_paste_cannot_release_or_resubmit_the_payload() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let (gate, _) = ready();
            gate.require_protocol("pty", agent, false);
            protocol(&gate, agent, State::Idle, 1);
            let guard = gate.prepare_prompt("pty", "payload").unwrap();
            gate.guarded_write_checked("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", |_| Ok(())).unwrap();
            assert!(gate.guarded_write_checked("pty", &guard, 2, b"\r", |_| Err(conflict("PTY has started working"))).is_err());
            assert_eq!(gate.finish_prompt("pty", &guard).unwrap(), WriteEvidence { touched: true, paste_complete: true });
            protocol(&gate, agent, State::Working, 2);
            protocol(&gate, agent, State::Idle, 3);
            assert!(gate.prepare_prompt("pty", "duplicate").is_err());
        }
    }

    #[test]
    fn uncertain_backend_failure_keeps_the_editor_reserved() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let (gate, _) = ready();
            gate.require_protocol("pty", agent, false);
            protocol(&gate, agent, State::Idle, 1);
            let guard = gate.prepare_prompt("pty", "payload").unwrap();
            assert!(gate.guarded_write_checked("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", |_| Err(AppError::io("reply lost"))).is_err());
            assert_eq!(gate.finish_prompt("pty", &guard).unwrap(), WriteEvidence { touched: true, paste_complete: false });
            protocol(&gate, agent, State::Idle, 2);
            assert!(gate.prepare_prompt("pty", "duplicate").is_err());
        }
    }

    #[test]
    fn codex_and_claude_require_native_reports_even_when_the_frontend_claims_idle() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
        let (gate, offer) = ready();
        gate.require_protocol("pty", agent, false);
        assert!(!gate.ready_tab("tab"));
        assert!(!gate.check(&offer, 1));
        assert!(gate.authorize(&offer, "batch", "attempt", "payload", 1).is_err());
        let mut sequence = 1;
        for state in [State::Working, State::Blocked, State::Error, State::Clear] {
            protocol(&gate, agent, state, sequence);
            sequence += 1;
            assert!(!gate.check(&offer, 1));
            assert!(gate.authorize(&offer, "batch", "attempt", "payload", 1).is_err());
        }
        protocol(&gate, agent, State::Idle, sequence);
        assert!(gate.check(&offer, 1));
        assert!(gate.ready_tab("tab"));
        // A stale working report and a late Stop Hook cannot replace the protocol record.
        protocol(&gate, agent, State::Working, 1);
        let mut hook = gate.modes.lock().unwrap()["pty"].protocol.clone().unwrap();
        hook.sequence = 999;
        hook.source = crate::agent::AgentStateSource::Hook;
        hook.state = crate::agent::AgentLifecycleState::AwaitingInput;
        gate.observe_agent_state("pty", &hook);
        assert!(gate.check(&offer, 1));
        gate.output_gap("pty");
        assert!(!gate.ready_tab("tab"));
        }
    }

    #[test]
    fn protocol_changes_after_paste_block_enter_even_if_the_agent_becomes_idle_again() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
        let (gate, offer) = ready();
        gate.require_protocol("pty", agent, false);
        protocol(&gate, agent, State::Idle, 1);
        let guard = gate.authorize(&offer, "batch", "attempt", "payload", 1).unwrap();
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", || Ok(())).unwrap();
        protocol(&gate, agent, State::Blocked, 2);
        assert!(gate.guarded_write("pty", &guard, 2, b"\r", || panic!("submitted into a dialog")).is_err());
        protocol(&gate, agent, State::Idle, 3);
        assert!(gate.guarded_write("pty", &guard, 2, b"\r", || panic!("reused an old input position")).is_err());
        // The known paste acknowledgement remains idempotent after state changes.
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", || panic!("pasted twice")).unwrap();
        }
    }

    #[test]
    fn one_idle_report_cannot_submit_two_batches() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
        let (gate, offer) = ready();
        gate.require_protocol("pty", agent, false);
        protocol(&gate, agent, State::Idle, 1);
        let guard = gate.authorize(&offer, "batch", "attempt", "payload", 1).unwrap();
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", || Ok(())).unwrap();
        gate.guarded_write("pty", &guard, 2, b"\r", || Ok(())).unwrap();
        gate.guarded_write("pty", &guard, 2, b"\r", || panic!("submitted twice")).unwrap();
        gate.finish("pty", "batch");
        assert!(!gate.ready_tab("tab"));
        protocol(&gate, agent, State::Working, 2);
        assert!(!gate.ready_tab("tab"));
        protocol(&gate, agent, State::Done, 3);
        assert!(gate.ready_tab("tab"));
        }
    }

    #[test]
    fn native_input_ownership_survives_frontend_owner_and_attachment_changes() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let (gate, _) = ready();
            gate.require_protocol("pty", agent, false);
            protocol(&gate, agent, State::Idle, 1);
            gate.user_write("pty", b"draft from another window", || Ok(())).unwrap();
            gate.register("pty", Some("tab".into()), std::env::temp_dir());
            gate.require_protocol("pty", agent, true);
            protocol(&gate, agent, State::Idle, 2);
            assert!(!gate.ready_tab("tab"));
            let binding = gate.bind(&BindRequest { tab_id: "tab".into(), terminal_session_id: "pty".into(), owner_id: "new-window".into() }, &std::env::temp_dir()).unwrap();
            assert!(gate.offer(&OfferRequest { binding, offer_id: "new-position".into(), running: true, idle: true,
                composer_empty: true, awaiting_input: false, prompt_queue_empty: true }, 1).is_err());
            // The reader must be able to publish the acknowledgement while a write holds input ownership.
            gate.user_write("pty", b"\r", || { protocol(&gate, agent, State::Working, 3); Ok(()) }).unwrap();
            protocol(&gate, agent, State::Done, 4);
            assert!(gate.ready_tab("tab"));
            gate.user_write("pty", b"later edit", || Ok(())).unwrap();
            protocol(&gate, agent, State::Idle, 5);
            assert!(!gate.ready_tab("tab"));
        }
    }

    #[test]
    fn dialog_answers_only_release_an_editor_that_was_empty_before_the_dialog() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            for draft in [false, true] {
                let (gate, _) = ready();
                gate.require_protocol("pty", agent, false);
                protocol(&gate, agent, State::Working, 1);
                if draft { gate.user_write("pty", b"next instruction", || Ok(())).unwrap(); }
                protocol(&gate, agent, State::Blocked, 2);
                gate.user_write("pty", b"answer", || Ok(())).unwrap();
                gate.user_write("pty", b"\r", || Ok(())).unwrap();
                protocol(&gate, agent, State::Working, 3);
                protocol(&gate, agent, State::Idle, 4);
                assert_eq!(gate.ready_tab("tab"), !draft);
            }
        }
    }

    #[test]
    fn unrelated_working_reports_and_failed_writes_do_not_acknowledge_drafts() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let (gate, _) = ready();
            gate.require_protocol("pty", agent, false);
            protocol(&gate, agent, State::Working, 1);
            gate.user_write("pty", b"queued draft", || Ok(())).unwrap();
            gate.user_write("pty", b"\r", || Ok(())).unwrap();
            protocol(&gate, agent, State::Working, 2);
            protocol(&gate, agent, State::Done, 3);
            assert!(!gate.ready_tab("tab"));
            assert!(gate.user_write("pty", b"\r", || { protocol(&gate, agent, State::Working, 4); Err(AppError::io("uncertain input")) }).is_err());
            protocol(&gate, agent, State::Done, 5);
            assert!(!gate.ready_tab("tab"));
        }
    }

    #[test]
    fn a_new_attachment_cannot_prove_an_existing_editor_is_empty() {
        use crate::agent::{AgentKind, ProgramState as State};
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let (gate, _) = ready();
            gate.require_protocol("pty", agent, true);
            protocol(&gate, agent, State::Idle, 1);
            assert!(!gate.ready_tab("tab"));
            gate.user_write("pty", b"\r", || Ok(())).unwrap();
            protocol(&gate, agent, State::Working, 2);
            protocol(&gate, agent, State::Idle, 3);
            assert!(gate.ready_tab("tab"));
        }
    }
}

#[cfg(test)]
mod payload_tests {
    use super::*;
    use std::cell::Cell;
    fn ready(payload: &str) -> (InputGate, WriteGuard) {
        let gate = InputGate::default();
        let root = std::env::temp_dir();
        gate.observe_output("pty", 1, b"\x1b[?2004h");
        gate.register("pty", Some("tab".into()), root.clone());
        let binding = gate
            .bind(
                &BindRequest { tab_id: "tab".into(), terminal_session_id: "pty".into(), owner_id: "owner".into() },
                &root,
            )
            .unwrap();
        let offer = gate
            .offer(
                &OfferRequest {
                    binding,
                    offer_id: "one".into(),
                    running: true,
                    idle: true,
                    composer_empty: true,
                    awaiting_input: false,
                    prompt_queue_empty: true,
                },
                0,
            )
            .unwrap();
        let guard = gate.authorize(&offer, "batch", "attempt", payload, 1).unwrap();
        (gate, guard)
    }
    #[test]
    fn wrong_or_missing_body_is_rejected_before_native_write() {
        let (gate, guard) = ready("frozen\nbody");
        for bytes in [b"\x1b[200~wrong\x1b[201~".as_slice(), b"\r", b"frozen\rbody"] {
            assert!(gate.guarded_write("pty", &guard, 1, bytes, || panic!("unbound payload reached PTY")).is_err());
        }
        assert!(!gate.has_written("pty", "batch"));
    }
    #[test]
    fn fragments_normalize_newlines_and_duplicate_sequences_do_not_append() {
        let (gate, guard) = ready("frozen\nbody");
        let writes = Cell::new(0);
        let chunks = [b"\x1b[20".as_slice(), b"0~frozen\r", b"body\x1b[201~"];
        for (index, bytes) in chunks.into_iter().enumerate() {
            let write = || {
                writes.set(writes.get() + 1);
                Ok(())
            };
            gate.guarded_write("pty", &guard, index as u64 + 1, bytes, write).unwrap();
            gate.guarded_write("pty", &guard, index as u64 + 1, bytes, || panic!("duplicate write")).unwrap();
        }
        assert_eq!(writes.get(), 3);
        assert!(!gate.has_written("pty", "batch"));
        gate.guarded_write("pty", &guard, 4, b"\r", || Ok(())).unwrap();
        assert!(gate.has_written("pty", "batch"));
        assert!(gate.guarded_write("pty", &guard, 5, b"\r", || panic!("second submission")).is_err());
    }
    #[test]
    fn missing_paste_suffix_cannot_submit() {
        let (gate, guard) = ready("frozen\nbody");
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~frozen\rbody", || Ok(())).unwrap();
        assert!(gate.guarded_write("pty", &guard, 2, b"\r", || panic!("unterminated paste submitted")).is_err());
        assert!(!gate.has_written("pty", "batch"));
    }
    #[test]
    fn dsr_response_during_paste_does_not_revoke_but_unsolicited_response_does() {
        let (gate, guard) = ready("frozen\nbody");
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~frozen\rbody\x1b[201~", || Ok(())).unwrap();
        gate.observe_output("pty", 2, b"\x1b[");
        gate.observe_output("pty", 3, b"6n");
        gate.user_write("pty", b"\x1b[12;34R", || Ok(())).unwrap();
        gate.guarded_write("pty", &guard, 2, b"\r", || Ok(())).unwrap();
        assert!(gate.has_written("pty", "batch"));
        let (gate, guard) = ready("frozen\nbody");
        gate.user_write("pty", b"\x1b[12;34R", || Ok(())).unwrap();
        assert!(!gate.valid_attempt("pty", "batch", &guard.target_epoch));
    }
    #[test]
    fn focus_reports_during_paste_do_not_revoke() {
        let (gate, guard) = ready("payload");
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", || Ok(())).unwrap();
        gate.user_write("pty", b"\x1b[O", || Ok(())).unwrap();
        gate.user_write("pty", b"\x1b[I", || Ok(())).unwrap();
        gate.guarded_write("pty", &guard, 2, b"\r", || Ok(())).unwrap();
        assert!(gate.has_written("pty", "batch"));
    }
    #[test]
    fn write_evidence_distinguishes_untouched_from_pasted() {
        let (gate, guard) = ready("payload");
        assert_eq!(gate.written("pty", "batch"), Some(WriteEvidence { touched: false, paste_complete: false }));
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", || Ok(())).unwrap();
        assert_eq!(gate.written("pty", "batch"), Some(WriteEvidence { touched: true, paste_complete: true }));
        assert_eq!(gate.written("pty", "other"), None);
    }
    #[test]
    fn disabled_bracketed_paste_never_writes_a_multiline_body() {
        let (gate, guard) = ready("frozen\nbody");
        gate.observe_output("pty", 2, b"\x1b[?2004l");
        assert!(
            gate.guarded_write("pty", &guard, 1, b"\x1b[200~frozen\rbody\x1b[201~", || panic!(
                "unsafe paste reached PTY"
            ))
            .is_err()
        );
        assert!(!gate.has_written("pty", "batch"));
    }
    #[test]
    fn native_lease_expires_without_waiting_for_the_source_pump() {
        let (gate, guard) = ready("payload");
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", || Ok(())).unwrap();
        gate.inner.lock().unwrap().get_mut("pty").unwrap().attempt.as_mut().unwrap().deadline = Instant::now();
        gate.guarded_write("pty", &guard, 1, b"\x1b[200~payload\x1b[201~", || panic!("cached write was repeated"))
            .unwrap();
        assert!(!gate.valid_attempt("pty", "batch", &guard.target_epoch));
        assert!(gate.guarded_write("pty", &guard, 2, b"\r", || panic!("expired write reached PTY")).is_err());
        assert!(!gate.has_written("pty", "batch"));
    }
}
