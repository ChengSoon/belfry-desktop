//! A verified Codex answer owns only the input it wrote, never an unrelated composer draft.
use super::*;
use crate::agent::{AgentKind, AgentSessionRef, ProgramState};

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InteractionGuard {
    pub request_id: String,
    pub protocol_sequence: u64,
}

pub(super) struct InteractionAttempt {
    guard: InteractionGuard,
    identity: Option<AgentSessionRef>,
    epoch: String,
    revision: u64,
    writes: u64,
    submitted: bool,
    editor_was_empty: bool,
}

impl InputGate {
    /// The UI has verified a live widget. Freeze its root status and share the keyboard fence.
    pub fn write_interaction(
        &self,
        session: &str,
        guard: &InteractionGuard,
        sequence: u64,
        bytes: &[u8],
        write: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let mut channels = self
            .inner
            .lock()
            .map_err(|_| conflict("Input registry is unavailable"))?;
        let modes = self
            .modes
            .lock()
            .map_err(|_| conflict("Terminal mode registry is unavailable"))?;
        let channel = channels
            .get_mut(session)
            .filter(|channel| channel.live)
            .ok_or_else(AppError::process_exited)?;
        let snapshot = modes
            .get(session)
            .and_then(|mode| mode.protocol.as_ref())
            .filter(|snapshot| {
                channel.protocol_agent == Some(AgentKind::Codex)
                    && snapshot.sequence == guard.protocol_sequence
                    && snapshot
                        .terminal_status_for(AgentKind::Codex)
                        .is_some_and(|report| {
                            matches!(report.state, ProgramState::Working | ProgramState::Blocked)
                        })
            })
            .ok_or_else(|| conflict("The terminal request's status changed"))?;
        if guard.request_id.is_empty()
            || guard.request_id.len() > 128
            || sequence == 0
            || sequence > MAX_WRITES as u64
            || bytes.is_empty()
            || bytes.len() > MAX_WRITE_BYTES
        {
            return Err(conflict("Invalid terminal answer write"));
        }
        if sequence == 1 {
            let previous = channel.interaction.as_ref();
            if previous.is_some_and(|attempt| attempt.guard == *guard) {
                return Err(conflict("The terminal answer was already started"));
            }
            // Consecutive questions may share one Working job. Carry forward only a successfully
            // submitted answer whose input generation and native identity have not changed.
            let continuing = previous.is_some_and(|attempt| {
                attempt.submitted
                    && attempt.revision == channel.revision
                    && attempt.epoch == channel.epoch
                    && attempt.identity == snapshot.session
            });
            if previous.is_some() && !continuing {
                return Err(conflict("The terminal contains an unfinished answer"));
            }
            let editor_was_empty = if continuing {
                previous.unwrap().editor_was_empty
            } else {
                editor_empty(channel, modes.get(session))
            };
            channel.interaction = Some(InteractionAttempt {
                guard: guard.clone(),
                identity: snapshot.session.clone(),
                epoch: channel.epoch.clone(),
                revision: channel.revision,
                writes: 0,
                submitted: false,
                editor_was_empty,
            });
        }
        channel
            .interaction
            .as_ref()
            .filter(|attempt| {
                attempt.guard == *guard
                    && attempt.identity == snapshot.session
                    && attempt.epoch == channel.epoch
                    && attempt.revision == channel.revision
                    && attempt.writes + 1 == sequence
                    && !attempt.submitted
            })
            .ok_or_else(|| conflict("The terminal answer was interrupted or already submitted"))?;
        // Keep the input lock, but let the PTY reader publish output during the write.
        drop(modes);
        channel.revision = channel
            .revision
            .checked_add(1)
            .ok_or_else(|| conflict("Input revision overflow"))?;
        channel.input_dirty = true;
        channel.submission_revision = None;
        channel.offer = None;
        if let Some(attempt) = &mut channel.attempt {
            attempt.revoked = true;
        }
        self.revision.fetch_add(1, Ordering::Release);
        let result = write();
        if result.is_ok() {
            let attempt = channel.interaction.as_mut().unwrap();
            attempt.revision = channel.revision;
            attempt.writes = sequence;
            attempt.submitted = submit_key(bytes) || matches!(bytes, b"y\r" | b"n\r");
        } else {
            // An uncertain write cannot grant permission to clear the editor or retry Enter.
            channel.interaction = None;
        }
        result
    }

    /// Called only after the same widget has disappeared from a fully parsed live screen.
    pub fn finish_interaction(
        &self,
        session: &str,
        guard: &InteractionGuard,
        ready_sequence: u64,
    ) -> Result<bool, AppError> {
        let mut channels = self
            .inner
            .lock()
            .map_err(|_| conflict("Input registry is unavailable"))?;
        let modes = self
            .modes
            .lock()
            .map_err(|_| conflict("Terminal mode registry is unavailable"))?;
        let channel = channels
            .get_mut(session)
            .filter(|channel| channel.live)
            .ok_or_else(AppError::process_exited)?;
        let Some(attempt) = channel.interaction.as_ref().filter(|attempt| {
            attempt.guard == *guard
                && attempt.submitted
                && attempt.editor_was_empty
                && attempt.revision == channel.revision
                && attempt.epoch == channel.epoch
        }) else {
            return Ok(false);
        };
        let Some(mode) = modes.get(session) else {
            return Ok(false);
        };
        if ready_sequence <= guard.protocol_sequence
            || !mode.readiness.allows(ready_sequence)
            || !protocol_idle(channel, Some(mode))
            || !mode.protocol.as_ref().is_some_and(|snapshot| {
                snapshot.agent == AgentKind::Codex && snapshot.session == attempt.identity
            })
        {
            return Ok(false);
        }
        channel.input_dirty = false;
        channel.submission_revision = None;
        channel.blocked_input = None;
        channel.interaction = None;
        self.revision.fetch_add(1, Ordering::Release);
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn status(gate: &InputGate, state: ProgramState, sequence: u64) {
        gate.observe_agent_state(
            "pty",
            &crate::agent::hooks::HookSnapshot {
                sequence,
                state: state.lifecycle(),
                agent: AgentKind::Codex,
                session: None,
                source: crate::agent::AgentStateSource::TerminalProtocol,
                occurred_at: 0,
                reason: String::new(),
                transcript_path: None,
                program_status: Some(crate::agent::TerminalProgramStatus {
                    state,
                    kind: None,
                    progress: None,
                    title: None,
                    message: None,
                }),
            },
        );
    }
    fn fixture() -> (InputGate, InteractionGuard) {
        let gate = InputGate::default();
        gate.register("pty", Some("tab".into()), std::env::temp_dir());
        gate.observe_output("pty", 1, b"\x1b[?2004h");
        gate.require_protocol("pty", AgentKind::Codex, false);
        status(&gate, ProgramState::Working, 1);
        (
            gate,
            InteractionGuard {
                request_id: "question".into(),
                protocol_sequence: 1,
            },
        )
    }

    #[test]
    fn successful_async_answer_waits_for_explicit_screen_completion_and_ready_status() {
        let (gate, guard) = fixture();
        gate.write_interaction("pty", &guard, 1, b"\x1b[B", || Ok(()))
            .unwrap();
        gate.write_interaction("pty", &guard, 2, b"\r", || Ok(()))
            .unwrap();
        assert!(!gate.finish_interaction("pty", &guard, 1).unwrap());
        status(&gate, ProgramState::Working, 2);
        status(&gate, ProgramState::Done, 3);
        assert!(!gate.ready_tab("tab")); // Unrelated Working reports cannot acknowledge this input.
        status(&gate, ProgramState::Idle, 4);
        assert!(gate.finish_interaction("pty", &guard, 3).unwrap()); // done -> idle is continuous.
        assert!(gate.ready_tab("tab"));
        assert!(!gate.finish_interaction("pty", &guard, 3).unwrap());
        assert!(gate.prepare_prompt("pty", "next room message").is_ok());
    }

    #[test]
    fn existing_drafts_and_unknown_reattached_editors_are_never_cleared_by_an_async_answer() {
        for reconnected in [false, true] {
            let (gate, guard) = fixture();
            if reconnected {
                gate.output_gap("pty");
                gate.observe_output("pty", 2, b"\x1b[?2004h");
                status(&gate, ProgramState::Working, 1);
            } else {
                gate.user_write("pty", b"queued draft", || Ok(())).unwrap();
            }
            gate.write_interaction("pty", &guard, 1, b"\r", || Ok(()))
                .unwrap();
            status(&gate, ProgramState::Done, 2);
            assert!(!gate.finish_interaction("pty", &guard, 2).unwrap());
            assert!(!gate.ready_tab("tab"));
        }
    }

    #[test]
    fn later_user_edits_ime_and_output_gaps_revoke_async_completion() {
        for change in 0..3 {
            let (gate, guard) = fixture();
            gate.write_interaction("pty", &guard, 1, b"\r", || Ok(()))
                .unwrap();
            match change {
                0 => gate.user_write("pty", b"later draft", || Ok(())).unwrap(),
                1 => gate.claim_user_input("pty").unwrap(),
                _ => {
                    gate.output_gap("pty");
                    gate.observe_output("pty", 2, b"\x1b[?2004h");
                }
            }
            status(&gate, ProgramState::Done, 2);
            assert!(!gate.finish_interaction("pty", &guard, 2).unwrap());
            assert!(!gate.ready_tab("tab"));
        }
    }

    #[test]
    fn user_input_between_navigation_and_enter_prevents_the_submit_key() {
        let (gate, guard) = fixture();
        gate.write_interaction("pty", &guard, 1, b"\x1b[B", || Ok(()))
            .unwrap();
        gate.claim_user_input("pty").unwrap();
        let wrote = Cell::new(false);
        assert!(
            gate.write_interaction("pty", &guard, 2, b"\r", || {
                wrote.set(true);
                Ok(())
            })
            .is_err()
        );
        assert!(!wrote.get());
        status(&gate, ProgramState::Done, 2);
        assert!(!gate.finish_interaction("pty", &guard, 2).unwrap());
        assert!(!gate.ready_tab("tab"));
    }

    #[test]
    fn blocked_confirmation_answers_can_finish_without_a_later_working_report() {
        for bytes in [b"\r".as_slice(), b"y\r", b"n\r"] {
            let (gate, mut guard) = fixture();
            status(&gate, ProgramState::Blocked, 2);
            guard.protocol_sequence = 2;
            gate.write_interaction("pty", &guard, 1, bytes, || Ok(()))
                .unwrap();
            status(&gate, ProgramState::Done, 3);
            assert!(!gate.ready_tab("tab"));
            assert!(gate.finish_interaction("pty", &guard, 3).unwrap());
            assert!(gate.ready_tab("tab"));
        }
    }

    #[test]
    fn ignored_navigation_and_uncertain_enter_cannot_release_the_editor() {
        for failed_enter in [false, true] {
            let (gate, guard) = fixture();
            gate.write_interaction("pty", &guard, 1, b"\x1b[B", || Ok(()))
                .unwrap();
            if failed_enter {
                assert!(
                    gate.write_interaction("pty", &guard, 2, b"\r", || Err(AppError::io(
                        "reply lost"
                    )))
                    .is_err()
                );
            }
            status(&gate, ProgramState::Done, 2);
            assert!(!gate.finish_interaction("pty", &guard, 2).unwrap());
            assert!(!gate.ready_tab("tab"));
        }
    }

    #[test]
    fn stale_status_and_reused_or_out_of_order_sequences_never_reach_the_pty() {
        let (gate, guard) = fixture();
        let writes = Cell::new(0);
        let write = || {
            writes.set(writes.get() + 1);
            Ok(())
        };
        assert!(
            gate.write_interaction("pty", &guard, 2, b"\r", write)
                .is_err()
        );
        gate.write_interaction("pty", &guard, 1, b"\x1b[B", write)
            .unwrap();
        assert!(
            gate.write_interaction("pty", &guard, 1, b"\r", write)
                .is_err()
        );
        status(&gate, ProgramState::Working, 2);
        assert!(
            gate.write_interaction("pty", &guard, 2, b"\r", write)
                .is_err()
        );
        assert_eq!(writes.get(), 1);
        status(&gate, ProgramState::Done, 3);
        assert!(!gate.finish_interaction("pty", &guard, 3).unwrap());
    }

    #[test]
    fn a_stale_ready_report_cannot_complete_an_answer_across_another_working_job() {
        let (gate, guard) = fixture();
        gate.write_interaction("pty", &guard, 1, b"\r", || Ok(()))
            .unwrap();
        status(&gate, ProgramState::Done, 2);
        status(&gate, ProgramState::Working, 3);
        status(&gate, ProgramState::Idle, 4);
        assert!(!gate.finish_interaction("pty", &guard, 2).unwrap());
        assert!(!gate.ready_tab("tab"));
        assert!(gate.finish_interaction("pty", &guard, 4).unwrap());
    }

    #[test]
    fn consecutive_async_questions_preserve_the_original_editor_ownership() {
        for draft in [false, true] {
            let (gate, guard) = fixture();
            if draft {
                gate.user_write("pty", b"draft", || Ok(())).unwrap();
            }
            gate.write_interaction("pty", &guard, 1, b"\r", || Ok(()))
                .unwrap();
            status(&gate, ProgramState::Blocked, 2);
            let next = InteractionGuard {
                request_id: "next question".into(),
                protocol_sequence: 2,
            };
            gate.write_interaction("pty", &next, 1, b"\x1b[B", || Ok(()))
                .unwrap();
            gate.write_interaction("pty", &next, 2, b"\r", || Ok(()))
                .unwrap();
            status(&gate, ProgramState::Done, 3);
            assert!(!gate.finish_interaction("pty", &guard, 3).unwrap());
            assert_eq!(gate.finish_interaction("pty", &next, 3).unwrap(), !draft);
            assert_eq!(gate.ready_tab("tab"), !draft);
        }
    }

    #[test]
    fn a_new_native_conversation_cannot_finish_an_old_answer() {
        let (gate, guard) = fixture();
        gate.write_interaction("pty", &guard, 1, b"\r", || Ok(()))
            .unwrap();
        status(&gate, ProgramState::Done, 2);
        {
            let mut modes = gate.modes.lock().unwrap();
            modes
                .get_mut("pty")
                .unwrap()
                .protocol
                .as_mut()
                .unwrap()
                .session = Some(AgentSessionRef {
                agent: AgentKind::Codex,
                id: "new-conversation".into(),
            });
        }
        assert!(!gate.finish_interaction("pty", &guard, 2).unwrap());
        assert!(!gate.ready_tab("tab"));
    }
}
