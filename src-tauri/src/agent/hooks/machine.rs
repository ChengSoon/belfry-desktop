use super::super::contracts::{
    AgentKind, AgentLifecycleState as State, AgentSessionRef, AgentStateSource,
};
use super::contracts::{HookInput, HookSnapshot};
use std::collections::{HashMap, HashSet};

pub(super) struct Machine {
    snapshot: HookSnapshot,
    waiting: HashSet<String>,
    active_tools: HashMap<String, String>,
    turn_id: Option<String>,
    last_event_at: i64,
    expected_session: Option<String>,
}

impl Machine {
    pub fn new(agent: AgentKind) -> Self {
        Self {
            snapshot: HookSnapshot {
                sequence: 0,
                agent,
                session: None,
                state: State::Unknown,
                source: AgentStateSource::ScreenHeuristic,
                occurred_at: 0,
                reason: belfry_i18n::text("Hook 尚未连接，当前使用屏幕推断").into(),
                transcript_path: None,
                program_status: None,
            },
            waiting: HashSet::new(),
            active_tools: HashMap::new(),
            turn_id: None,
            last_event_at: 0,
            expected_session: None,
        }
    }

    pub fn configure(&mut self, resume: Option<String>, fallback: String) {
        self.expected_session = resume;
        self.snapshot.reason = fallback;
    }

    pub fn exited(&mut self, code: i32, terminated: bool) -> HookSnapshot {
        self.snapshot.state = if code != 0 && !terminated {
            State::Failed
        } else {
            State::Interrupted
        };
        self.snapshot.source = AgentStateSource::Process;
        self.snapshot.reason = if terminated {
            belfry_i18n::text("会话已关闭").into()
        } else {
            belfry_i18n::lformat!("进程已退出（{code}）")
        };
        self.snapshot.sequence += 1;
        self.snapshot.occurred_at = now();
        self.snapshot()
    }

    pub fn apply(&mut self, input: HookInput) -> Option<HookSnapshot> {
        if !self.accepts(&input) {
            return None;
        }
        let before = self.snapshot.clone();
        let state = self.next_state(&input)?;
        self.last_event_at = input.occurred_at;
        self.bind_session(&input);
        self.snapshot.state = state;
        self.snapshot.source = AgentStateSource::Hook;
        self.snapshot.reason = reason(state).into();
        self.publish_if_changed(before, input.occurred_at)
    }

    pub fn snapshot(&self) -> HookSnapshot {
        self.snapshot.clone()
    }

    fn bind_session(&mut self, input: &HookInput) {
        let changed = self
            .snapshot
            .session
            .as_ref()
            .is_none_or(|session| session.id != input.session_id);
        if changed || input.transcript_path.is_some() {
            self.snapshot.transcript_path = input.transcript_path.clone();
        }
        self.snapshot.session = Some(AgentSessionRef {
            agent: self.snapshot.agent,
            id: input.session_id.clone(),
        });
    }

    pub fn accepts(&self, input: &HookInput) -> bool {
        if input.agent_id.is_some()
            || input.occurred_at < self.last_event_at
            || crate::agent::validate_agent_session_id(&input.session_id).is_err()
            || !super::input::EVENTS.contains(&input.event.as_str())
        {
            return false;
        }
        self.accepts_session(input) && self.accepts_turn(input)
    }

    fn accepts_session(&self, input: &HookInput) -> bool {
        let switches = input.event == "SessionStart"
            && matches!(input.source.as_deref(), Some("clear" | "resume"));
        if self.snapshot.session.is_none()
            && self
                .expected_session
                .as_ref()
                .is_some_and(|id| id != &input.session_id)
        {
            return false;
        }
        if !switches
            && self
                .snapshot
                .session
                .as_ref()
                .is_some_and(|session| session.id != input.session_id)
        {
            return false;
        }
        true
    }

    fn accepts_turn(&self, input: &HookInput) -> bool {
        input.event == "UserPromptSubmit"
            || input.event == "SessionStart"
            || input
                .turn_id
                .as_ref()
                .zip(self.turn_id.as_ref())
                .is_none_or(|(incoming, current)| incoming == current)
    }

    fn next_state(&mut self, input: &HookInput) -> Option<State> {
        match input.event.as_str() {
            "SessionStart" => Some(self.session_start(input)),
            "UserPromptSubmit" => {
                self.reset_tools();
                self.turn_id = input.turn_id.clone();
                Some(State::Processing)
            }
            "Notification" => self.notification(input),
            _ => self
                .tool_state(input)
                .or_else(|| self.lifecycle_state(input)),
        }
    }

    fn session_start(&mut self, input: &HookInput) -> State {
        if input.source.as_deref() == Some("compact") {
            return self.working();
        }
        self.reset_tools();
        self.turn_id = None;
        State::Unknown
    }

    fn tool_state(&mut self, input: &HookInput) -> Option<State> {
        match input.event.as_str() {
            "PermissionRequest" => {
                self.wait_for_tool(input);
                Some(State::AwaitingInput)
            }
            "PreToolUse" => {
                self.remember_tool(input);
                if matches!(
                    input.tool_name.as_deref(),
                    Some(
                        "AskUserQuestion"
                            | "request_user_input"
                            | "AskUser"
                            | "question"
                            | "notify_user"
                            | "ask_question"
                    )
                ) {
                    self.waiting.insert(wait_key(input));
                }
                Some(self.working())
            }
            "PostToolUse" | "PostToolUseFailure" | "PermissionResult" => {
                self.finish_tool(input);
                Some(if input.is_interrupt && self.waiting.is_empty() {
                    State::Interrupted
                } else {
                    self.working()
                })
            }
            _ => None,
        }
    }

    fn remember_tool(&mut self, input: &HookInput) {
        if let (Some(key), Some(fingerprint)) = (&input.tool_key, &input.tool_fingerprint) {
            if key != fingerprint {
                self.active_tools.insert(key.clone(), fingerprint.clone());
            }
        }
    }

    fn wait_for_tool(&mut self, input: &HookInput) {
        let key = wait_key(input);
        if input.tool_fingerprint.as_ref() == Some(&key) {
            let candidates: Vec<_> = self
                .active_tools
                .iter()
                .filter(|(_, fingerprint)| *fingerprint == &key)
                .map(|(id, _)| id.clone())
                .collect();
            if !candidates.is_empty() {
                // No ID means identical parallel inputs are ambiguous. Keep all
                // candidates blocked until their own result arrives.
                self.waiting.extend(candidates);
                return;
            }
        }
        self.remember_tool(input);
        self.waiting.insert(key);
    }

    fn finish_tool(&mut self, input: &HookInput) {
        let key = wait_key(input);
        self.waiting.remove(&key);
        let registered = self.active_tools.remove(&key);
        for fingerprint in registered.iter().chain(input.tool_fingerprint.iter()) {
            // Also handle a missing PreToolUse or input rewritten by a hook.
            // A parallel invocation with this input still owns its wait.
            if !self
                .active_tools
                .values()
                .any(|active| active == fingerprint)
            {
                self.waiting.remove(fingerprint);
            }
        }
        self.waiting.remove("notification");
    }

    fn reset_tools(&mut self) {
        self.waiting.clear();
        self.active_tools.clear();
    }

    fn lifecycle_state(&mut self, input: &HookInput) -> Option<State> {
        match input.event.as_str() {
            "Stop" => Some(if !self.waiting.is_empty() {
                State::AwaitingInput
            } else if input.background_work {
                State::Processing
            } else {
                self.active_tools.clear();
                State::Completed
            }),
            "StopFailure" => {
                self.reset_tools();
                Some(State::Failed)
            }
            "Interrupt" | "SessionEnd" => {
                self.reset_tools();
                Some(State::Interrupted)
            }
            "PreCompact" | "PostCompact" => Some(self.working()),
            _ => None,
        }
    }

    fn working(&self) -> State {
        if self.waiting.is_empty() {
            State::Processing
        } else {
            State::AwaitingInput
        }
    }

    fn notification(&mut self, input: &HookInput) -> Option<State> {
        match input.notification_type.as_deref() {
            Some("permission_prompt" | "elicitation_dialog") => {
                self.waiting.insert("notification".into());
                Some(State::AwaitingInput)
            }
            _ => None,
        }
    }

    fn publish_if_changed(&mut self, before: HookSnapshot, at: i64) -> Option<HookSnapshot> {
        if before.state == self.snapshot.state
            && before.source == self.snapshot.source
            && before.session == self.snapshot.session
            && before.transcript_path == self.snapshot.transcript_path
        {
            return None;
        }
        self.snapshot.sequence += 1;
        self.snapshot.occurred_at = at;
        Some(self.snapshot())
    }
}

fn wait_key(input: &HookInput) -> String {
    input
        .tool_key
        .clone()
        .unwrap_or_else(|| "notification".into())
}

fn reason(state: State) -> &'static str {
    match state {
        State::Starting => belfry_i18n::text("正在启动"),
        State::Processing => belfry_i18n::text("正在处理"),
        State::AwaitingInput => belfry_i18n::text("等待确认或输入"),
        State::Completed => belfry_i18n::text("本轮响应结束"),
        State::Failed => belfry_i18n::text("本轮响应失败"),
        State::Interrupted => belfry_i18n::text("会话已中断或退出"),
        State::Unknown => belfry_i18n::text("Hook 已连接，等待新指令"),
    }
}

pub(super) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}
