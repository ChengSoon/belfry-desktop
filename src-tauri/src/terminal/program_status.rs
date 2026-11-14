//! OSC 7501 revision 0.4. Only the launched agent's root record controls foreground delivery.
//! https://www.superlogical.com/rex/docs/build/program-status
use crate::agent::{AgentKind, AgentStateSource, ProgramState, ProgramBlockKind, TerminalProgramStatus, hooks::HookSnapshot};
#[cfg(test)]
use crate::agent::AgentLifecycleState as State;
use base64::{Engine, engine::general_purpose::{STANDARD, STANDARD_NO_PAD}};
use std::collections::BTreeMap;

pub(super) const REPLY: &[u8] = b"\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\";

pub(super) struct ProgramStatus {
    agent: AgentKind,
    parser: Parser,
    records: BTreeMap<String, (u64, BTreeMap<String, String>)>,
    sequence: u64,
    record_revision: u64,
}

#[derive(Default)]
enum Parser {
    #[default]
    Ground,
    Escape,
    Osc { body: Vec<u8>, escape: bool, oversized: bool },
    OtherString(bool),
}

impl ProgramStatus {
    pub fn new(agent: AgentKind) -> Self {
        Self { agent, parser: Parser::default(), records: BTreeMap::new(), sequence: 0, record_revision: 0 }
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<HookSnapshot> {
        let mut updates = Vec::new();
        for &byte in bytes {
            self.parser = match std::mem::take(&mut self.parser) {
                Parser::Ground if byte == 0x1b => Parser::Escape,
                Parser::Escape if byte == b']' => Parser::Osc { body: Vec::new(), escape: false, oversized: false },
                Parser::Escape if matches!(byte, b'P' | b'_' | b'^' | b'X') => Parser::OtherString(false),
                Parser::Escape if byte == b'c' => {
                    self.records.clear();
                    updates.push(self.snapshot(cleared()));
                    Parser::Ground
                }
                Parser::Escape if byte == 0x1b => Parser::Escape,
                Parser::Osc { .. } if matches!(byte, 0x18 | 0x1a) => Parser::Ground,
                Parser::Osc { body, escape, oversized } if byte == 7 || escape && byte == b'\\' => {
                    // OSC + body + actual terminator must fit the sequence budget.
                    if !oversized && 2 + body.len() + (if byte == 7 { 1 } else { 2 }) <= 4096 {
                        if let Some(state) = self.report(&body) {
                            updates.push(self.snapshot(state));
                        }
                    }
                    Parser::Ground
                }
                Parser::Osc { mut body, escape, mut oversized } => {
                    if escape { oversized = true; } // Embedded controls cannot form a report.
                    if byte != 0x1b && body.len() < 4094 { body.push(byte); }
                    else if byte != 0x1b { oversized = true; }
                    Parser::Osc { body, escape: byte == 0x1b, oversized }
                }
                Parser::OtherString(escape) if matches!(byte, 0x18 | 0x1a) || escape && byte == b'\\' => Parser::Ground,
                Parser::OtherString(_) => Parser::OtherString(byte == 0x1b),
                _ => Parser::Ground,
            };
        }
        updates
    }

    fn snapshot(&mut self, report: TerminalProgramStatus) -> HookSnapshot {
        self.sequence += 1;
        let state = report.state.lifecycle();
        HookSnapshot {
            sequence: self.sequence, agent: self.agent, session: None, state,
            source: AgentStateSource::TerminalProtocol,
            occurred_at: crate::rooms::model::now_millis(),
            reason: report.message.clone().unwrap_or_else(|| match report.state {
                ProgramState::Idle => belfry_i18n::text("空闲，等待新指令"),
                ProgramState::Done => belfry_i18n::text("本轮响应结束"),
                ProgramState::Working => belfry_i18n::text("正在处理"),
                ProgramState::Blocked => belfry_i18n::text("等待确认或输入"),
                ProgramState::Error => belfry_i18n::text("本轮响应失败"),
                ProgramState::Clear => belfry_i18n::text("等待原生状态报告"),
            }.into()), transcript_path: None, program_status: Some(report),
        }
    }

    fn report(&mut self, body: &[u8]) -> Option<TerminalProgramStatus> {
        if body == b"133;A" || body.starts_with(b"133;A;") {
            return self.end_work();
        }
        let body = std::str::from_utf8(body).ok()?.strip_prefix("7501;")?;
        let mut fields = BTreeMap::new();
        for pair in body.split(':') {
            let Some((key, value)) = pair.split_once('=') else { continue; };
            let (key, value) = (key.trim(), value.trim());
            if key.len() > 16 { return None; }
            // A malformed id must never fall back to the root, including a skipped alphabet pair.
            if key == "id" && !valid_id(value) { return None; }
            if key.is_empty() || !key.bytes().all(|b| b.is_ascii_lowercase())
                || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.,+/=-".contains(&b)) { continue; }
            // Validate every text pair before changing any record, even if a later pair replaces it.
            if matches!(key, "msg" | "title") {
                let (encoded, decoded) = if key == "msg" { (2732, 2048) } else { (256, 192) };
                if value.len() > encoded { return None; }
                let bytes = STANDARD.decode(value).or_else(|_| STANDARD_NO_PAD.decode(value)).ok()?;
                let text = std::str::from_utf8(&bytes).ok()?;
                if bytes.len() > decoded || text.chars().any(|ch| ch.is_control()) { return None; }
            }
            if key == "app" && value.len() > 32 { return None; }
            if matches!(key, "state" | "id" | "app" | "kind" | "progress" | "msg" | "title") {
                fields.insert(key.to_string(), value.to_string());
            }
        }
        let state = fields.get("state")?.as_str();
        let next = match state {
            "idle" => ProgramState::Idle,
            "done" => ProgramState::Done,
            "working" => ProgramState::Working,
            "blocked" => ProgramState::Blocked,
            "error" => ProgramState::Error,
            "clear" => ProgramState::Clear,
            _ => return None,
        };
        let id = fields.get("id").cloned().unwrap_or_default();
        if fields.contains_key("id") && !valid_id(&id) { return None; }
        let report = TerminalProgramStatus {
            state: next,
            kind: (next == ProgramState::Blocked).then(|| match fields.get("kind").map(String::as_str) {
                Some("permission") => Some(ProgramBlockKind::Permission),
                Some("question") => Some(ProgramBlockKind::Question),
                Some("auth") => Some(ProgramBlockKind::Auth),
                _ => None,
            }).flatten(),
            progress: matches!(next, ProgramState::Working | ProgramState::Blocked).then(|| {
                fields.get("progress").filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
                    .and_then(|value| value.parse::<u8>().ok()).filter(|value| *value <= 100)
            }).flatten(),
            title: fields.get("title").and_then(|value| decoded_text(value)),
            message: fields.get("msg").and_then(|value| decoded_text(value)),
        };
        let mut root_evicted = false;
        if state == "clear" {
            self.records.retain(|key, _| !(id.is_empty() || key == &id || key.starts_with(&format!("{id}/"))));
        } else {
            if !self.records.contains_key(&id) && self.records.len() >= 256 {
                if let Some(oldest) = self.records.iter().min_by_key(|(_, (at, _))| *at).map(|(id, _)| id.clone()) {
                    root_evicted = oldest.is_empty();
                    self.records.remove(&oldest);
                }
            }
            let matching_app = self.agent.terminal_status_app().is_some_and(|expected| fields.get("app").is_some_and(|app| app == expected));
            self.record_revision += 1;
            self.records.insert(id.clone(), (self.record_revision, fields));
            if !matching_app { return if id.is_empty() || root_evicted { Some(cleared()) } else { None }; }
        }
        if id.is_empty() { Some(report) } else if root_evicted { Some(cleared()) } else { None }
    }

    pub fn exited(&mut self) -> Option<HookSnapshot> {
        self.end_work().map(|report| self.snapshot(report))
    }

    fn end_work(&mut self) -> Option<TerminalProgramStatus> {
        let expires = |fields: &BTreeMap<String, String>| matches!(fields.get("state").map(String::as_str), Some("working" | "blocked"));
        let root_expired = self.records.get("").is_some_and(|(_, fields)| expires(fields)
            && self.agent.terminal_status_app().is_some_and(|app| fields.get("app").is_some_and(|value| value == app)));
        self.records.retain(|_, (_, fields)| !expires(fields));
        root_expired.then(cleared)
    }
}

fn cleared() -> TerminalProgramStatus {
    TerminalProgramStatus { state: ProgramState::Clear, kind: None, progress: None, title: None, message: None }
}

fn decoded_text(value: &str) -> Option<String> {
    String::from_utf8(STANDARD.decode(value).or_else(|_| STANDARD_NO_PAD.decode(value)).ok()?).ok()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.split('/').count() <= 8 && id.split('/').all(|part| {
        !part.is_empty() && part.len() <= 32 && part.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.+-".contains(&b))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn report(state: &str) -> String { format!("\x1b]7501;state={state}:app=claude-code\x1b\\") }

    #[test]
    fn real_claude_states_survive_every_byte_boundary() {
        for (wire, expected) in [("working", State::Processing), ("blocked", State::AwaitingInput), ("idle", State::Completed), ("done", State::Completed), ("error", State::Failed)] {
            let input = report(wire);
            for split in 0..=input.len() {
                let mut parser = ProgramStatus::new(AgentKind::Claude);
                let mut updates = parser.feed(&input.as_bytes()[..split]);
                updates.extend(parser.feed(&input.as_bytes()[split..]));
                assert_eq!(updates.len(), 1);
                assert_eq!(updates[0].state, expected);
                assert_eq!(updates[0].source, AgentStateSource::TerminalProtocol);
            }
        }
    }

    #[test]
    fn child_status_cannot_open_or_close_the_foreground_queue() {
        let mut p = ProgramStatus::new(AgentKind::Claude);
        assert_eq!(p.feed(report("working").as_bytes()).len(), 1);
        assert!(p.feed(b"\x1b]7501;state=done:app=claude-code:id=agent/1\x07").is_empty());
        assert!(p.feed(b"\x1b]7501;state=clear:id=agent\x07").is_empty());
        assert!(p.records.contains_key(""));
        assert!(!p.records.contains_key("agent/1"));
        assert_eq!(p.feed(b"\x1b]7501;state=clear\x07")[0].state, State::Unknown);
    }

    #[test]
    fn unknown_malformed_and_oversized_reports_never_announce_idle() {
        let mut p = ProgramStatus::new(AgentKind::Claude);
        for body in ["state=idle:id=bad//id:app=claude-code", "state=new:app=claude-code", "state=idle:app=claude-code:msg=A", "state=idle:app=claude-code:msg=Cg==", "state=idle:app=claude-code:title=/w=="] {
            assert!(p.feed(format!("\x1b]7501;{body}\x07").as_bytes()).is_empty(), "{body}");
        }
        let oversized = format!("\x1b]7501;{}state=idle:app=claude-code\x07", "x=a:".repeat(1200));
        assert!(p.feed(oversized.as_bytes()).is_empty());
        assert!(p.feed(format!("\x1bP{}\x1b\\", report("idle")).as_bytes()).is_empty());
        assert!(p.feed(b"idle working done ? for shortcuts").is_empty());
    }

    #[test]
    fn malformed_unknown_pairs_are_skipped_and_last_value_wins() {
        let mut p = ProgramStatus::new(AgentKind::Claude);
        let input = b"\x1b]7501;state=working:state=idle:future=a,b:bad pair:app=claude-code:msg=5a6M5oiQ\x07";
        assert_eq!(p.feed(input)[0].state, State::Completed);
        assert_eq!(p.feed(b"\x1bc")[0].state, State::Unknown);
        assert!(p.records.is_empty());
    }

    #[test]
    fn replacement_and_eviction_cannot_leave_a_stale_idle_root() {
        let mut p = ProgramStatus::new(AgentKind::Claude);
        p.feed(report("idle").as_bytes());
        assert_eq!(p.feed(b"\x1b]7501;state=idle\x07")[0].state, State::Unknown);
        p.feed(report("idle").as_bytes());
        for id in 0..255 {
            assert!(p.feed(format!("\x1b]7501;state=done:id=child/{id}\x07").as_bytes()).is_empty());
        }
        assert_eq!(p.feed(b"\x1b]7501;state=done:id=child/new\x07")[0].state, State::Unknown);
        assert_eq!(p.records.len(), 256);
        assert!(!p.records.contains_key(""));
    }

    #[test]
    fn codex_reports_preserve_original_states_and_blocking_kinds_at_every_byte_boundary() {
        for (wire, state, kind) in [
            ("state=idle:app=codex", ProgramState::Idle, None),
            ("state=working:app=codex", ProgramState::Working, None),
            ("state=blocked:app=codex:kind=permission", ProgramState::Blocked, Some(ProgramBlockKind::Permission)),
            ("state=blocked:app=codex:kind=question", ProgramState::Blocked, Some(ProgramBlockKind::Question)),
            ("state=blocked:app=codex:kind=auth", ProgramState::Blocked, Some(ProgramBlockKind::Auth)),
            ("state=done:app=codex", ProgramState::Done, None),
            ("state=error:app=codex", ProgramState::Error, None),
            ("state=clear", ProgramState::Clear, None),
        ] {
            let input = format!("\x1b]7501;{wire}\x1b\\");
            for split in 0..=input.len() {
                let mut parser = ProgramStatus::new(AgentKind::Codex);
                let mut updates = parser.feed(&input.as_bytes()[..split]);
                updates.extend(parser.feed(&input.as_bytes()[split..]));
                assert_eq!(updates.len(), 1, "{wire} at {split}");
                let report = updates[0].terminal_status_for(AgentKind::Codex).unwrap();
                assert_eq!(report.state, state);
                assert_eq!(report.kind, kind);
                assert_eq!(updates[0].agent, AgentKind::Codex);
            }
        }
    }

    #[test]
    fn agent_identity_children_and_free_text_cannot_change_foreground_readiness() {
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let app = agent.terminal_status_app().unwrap();
            let other = if agent == AgentKind::Codex { "claude-code" } else { "codex" };
            let mut parser = ProgramStatus::new(agent);
            parser.feed(format!("\x1b]7501;state=working:app={app}\x07").as_bytes());
            assert!(parser.feed(format!("\x1b]7501;state=done:app={app}:id=agent/1\x07").as_bytes()).is_empty());
            let updates = parser.feed(format!("\x1b]7501;state=blocked:app={app}:kind=question:progress=99:title=VGFzaw==:msg=ZG9uZSwgaWRsZQ==\x07").as_bytes());
            let report = updates[0].program_status.as_ref().unwrap();
            assert_eq!(report.state, ProgramState::Blocked);
            assert_eq!(report.kind, Some(ProgramBlockKind::Question));
            assert_eq!(report.progress, Some(99));
            assert_eq!(report.title.as_deref(), Some("Task"));
            assert_eq!(report.message.as_deref(), Some("done, idle"));
            let updates = parser.feed(format!("\x1b]7501;state=idle:app={other}\x07").as_bytes());
            assert_eq!(updates[0].program_status.as_ref().unwrap().state, ProgramState::Clear);
            assert!(parser.feed(b"idle completed ready ? for shortcuts").is_empty());
        }
    }

    #[test]
    fn shell_prompts_and_exit_expire_working_and_blocked_but_preserve_results() {
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let app = agent.terminal_status_app().unwrap();
            for state in ["working", "blocked"] {
                let mut parser = ProgramStatus::new(agent);
                parser.feed(format!("\x1b]7501;state={state}:app={app}\x07\x1b]7501;state=working:id=child\x07\x1b]7501;state=done:id=result\x07").as_bytes());
                let updates = parser.feed(b"\x1b]133;A;prompt\x1b\\");
                assert_eq!(updates[0].program_status.as_ref().unwrap().state, ProgramState::Clear);
                assert!(!parser.records.contains_key(""));
                assert!(!parser.records.contains_key("child"));
                assert!(parser.records.contains_key("result"));
                assert!(parser.exited().is_none());
                parser.feed(format!("\x1b]7501;state={state}:app={app}\x07").as_bytes());
                assert_eq!(parser.exited().unwrap().program_status.unwrap().state, ProgramState::Clear);
            }
            for state in ["idle", "done", "error"] {
                let mut parser = ProgramStatus::new(agent);
                parser.feed(format!("\x1b]7501;state={state}:app={app}\x07").as_bytes());
                assert!(parser.feed(b"\x1b]133;A\x07").is_empty());
                assert!(parser.exited().is_none());
                assert!(parser.records.contains_key(""));
            }
        }
    }

    #[test]
    fn cancelled_osc_sequences_cannot_announce_idle_and_do_not_swallow_the_next_report() {
        for cancel in [0x18, 0x1a] {
            let mut parser = ProgramStatus::new(AgentKind::Claude);
            let mut input = b"\x1b]7501;state=idle:app=claude-code".to_vec();
            input.push(cancel);
            input.extend_from_slice(report("working").as_bytes());
            let updates = parser.feed(&input);
            assert_eq!(updates.len(), 1);
            assert_eq!(updates[0].program_status.as_ref().unwrap().state, ProgramState::Working);
        }
    }
}
