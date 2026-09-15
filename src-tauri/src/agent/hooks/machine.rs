use super::super::contracts::{
    AgentKind, AgentLifecycleState as State, AgentSessionRef, AgentStateSource,
};
use super::contracts::{HookInput, HookSnapshot};
use std::collections::HashSet;

pub(super) struct Machine {
    snapshot: HookSnapshot,
    waiting: HashSet<String>,
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
                reason: "Hook 尚未连接，当前使用屏幕推断".into(),
                transcript_path: None,
            },
            waiting: HashSet::new(),
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
            "会话已关闭".into()
        } else {
            format!("进程已退出（{code}）")
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
                self.waiting.clear();
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
        self.waiting.clear();
        self.turn_id = None;
        State::Unknown
    }

    fn tool_state(&mut self, input: &HookInput) -> Option<State> {
        match input.event.as_str() {
            "PermissionRequest" => {
                self.waiting.insert(wait_key(input));
                Some(State::AwaitingInput)
            }
            "PreToolUse" => {
                if matches!(
                    input.tool_name.as_deref(),
                    Some("AskUserQuestion" | "request_user_input")
                ) {
                    self.waiting.insert(wait_key(input));
                }
                Some(self.working())
            }
            "PostToolUse" | "PostToolUseFailure" => {
                self.waiting.remove(&wait_key(input));
                self.waiting.remove("notification");
                Some(if input.is_interrupt && self.waiting.is_empty() {
                    State::Interrupted
                } else {
                    self.working()
                })
            }
            _ => None,
        }
    }

    fn lifecycle_state(&mut self, input: &HookInput) -> Option<State> {
        match input.event.as_str() {
            "Stop" => Some(if !self.waiting.is_empty() {
                State::AwaitingInput
            } else if input.background_work {
                State::Processing
            } else {
                State::Completed
            }),
            "StopFailure" => {
                self.waiting.clear();
                Some(State::Failed)
            }
            "Interrupt" | "SessionEnd" => {
                self.waiting.clear();
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
        State::Starting => "正在启动",
        State::Processing => "正在处理",
        State::AwaitingInput => "等待确认或输入",
        State::Completed => "本轮响应结束",
        State::Failed => "本轮响应失败",
        State::Interrupted => "会话已中断或退出",
        State::Unknown => "Hook 已连接，等待新指令",
    }
}

pub(super) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}
