//! Native ownership and input-generation fence for collaboration delivery.
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
}
struct Attempt {
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
    error: Option<String>,
    submit_key: bool,
}

fn conflict(message: &str) -> AppError {
    AppError::conflict(message)
}
fn same_binding(channel: &Channel, binding: &Binding) -> bool {
    channel.live
        && channel.tab_id.as_deref() == Some(&binding.tab_id)
        && channel.owner.as_deref() == Some(&binding.owner_id)
        && channel.epoch == binding.target_epoch
        && channel.revision == binding.input_revision
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
                },
            );
        }
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
            channel.offer = None;
            if let Some(attempt) = &mut channel.attempt {
                attempt.revoked = true;
            }
        }
    }
    pub fn ready_tab(&self, tab: &str) -> bool {
        let Ok(modes) = self.modes.lock() else {
            return false;
        };
        self.inner.lock().ok().is_some_and(|channels| {
            channels.iter().any(|(id, channel)| {
                channel.live
                    && channel.tab_id.as_deref() == Some(tab)
                    && modes.get(id).is_some_and(|mode| mode.bracketed_paste)
            })
        })
    }
    pub fn safe_paste(&self, session: &str) -> bool {
        self.modes.lock().ok().is_some_and(|modes| modes.get(session).is_some_and(|mode| mode.bracketed_paste))
    }

    pub fn offer(&self, request: &OfferRequest, now: i64) -> Result<Offer, AppError> {
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
        let modes = self.modes.lock().map_err(|_| conflict("Terminal mode registry is unavailable"))?;
        if !modes.get(&offer.binding.terminal_session_id).is_some_and(|mode| mode.bracketed_paste) {
            return Err(conflict("Safe multi-line paste is not enabled"));
        }
        if payload.is_empty()
            || payload.len() > belfry_protocol::inbox::MAX_BATCH_BYTES
            || payload.contains("\x1b[201~")
            || payload.contains('\0')
        {
            return Err(conflict("Frozen payload cannot be safely pasted"));
        }
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        let channel = channels.get_mut(&offer.binding.terminal_session_id).ok_or_else(AppError::process_exited)?;
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
        let normalized = payload.replace("\r\n", "\n").replace('\r', "\n");
        let mut frames: Vec<_> = [normalized.clone(), normalized.replace('\n', "\r"), normalized.replace('\n', "\r\n")]
            .iter()
            .map(|text| format!("\x1b[200~{text}\x1b[201~").into_bytes())
            .collect();
        frames.sort();
        frames.dedup();
        channel.attempt = Some(Attempt {
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
        let mut modes = self.modes.lock().map_err(|_| conflict("Terminal mode registry is unavailable"))?;
        let protocol_response =
            modes.get_mut(session).is_some_and(|mode| mode.response(bytes, crate::rooms::model::now_millis()));
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        if !bytes.is_empty()
            && !protocol_response
            && let Some(channel) = channels.get_mut(session)
        {
            channel.revision = channel.revision.checked_add(1).ok_or_else(|| conflict("Input revision overflow"))?;
            channel.offer = None;
            if let Some(attempt) = &mut channel.attempt {
                attempt.revoked = true;
            }
        }
        write()
    }

    /// Reserve the write sequence before touching the PTY; a failed/unknown write is never retried.
    pub fn guarded_write(
        &self,
        session: &str,
        guard: &WriteGuard,
        sequence: u64,
        bytes: &[u8],
        write: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let modes = self.modes.lock().map_err(|_| conflict("Terminal mode registry is unavailable"))?;
        let mut channels = self.inner.lock().map_err(|_| conflict("Input registry is unavailable"))?;
        let channel = channels.get_mut(session).ok_or_else(AppError::process_exited)?;
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
            return previous.error.as_ref().map_or(Ok(()), |error| Err(AppError::io(error.clone())));
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
        let submit_key =
            attempt.paste_complete && matches!(bytes, b"\r" | b"\n" | b"\r\n" | b"\x1b[13u" | b"\x1b[13;1u");
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
            .insert(sequence, Written { hash, error: Some("Automatic write result is uncertain".into()), submit_key });
        let result = write();
        attempt.writes.get_mut(&sequence).unwrap().error = result.as_ref().err().map(|error| error.message.clone());
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
