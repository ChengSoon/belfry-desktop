use super::{contracts::SessionTokens, details::Details};
use serde_json::Value;

#[derive(Default)]
pub(super) struct CodexUsage {
    current: Option<SessionTokens>,
    finished: Vec<SessionTokens>,
}

impl CodexUsage {
    pub fn consume(&mut self, record: &Value, details: &mut Details) {
        let payload = &record["payload"];
        match record["type"].as_str() {
            Some("turn_context") => details.model(&payload["model"]),
            Some("event_msg") if payload["type"] == "token_count" => {
                self.usage(&payload["info"]["total_token_usage"])
            }
            Some("response_item") => take_tool(payload, details),
            _ => {}
        }
    }

    fn usage(&mut self, value: &Value) {
        if !value.is_object() {
            return;
        }
        let next = SessionTokens::codex(value);
        if self
            .current
            .as_ref()
            .is_some_and(|previous| next.reset_after(previous))
        {
            self.finished.extend(self.current.take());
        }
        self.current = Some(next);
    }

    pub fn tokens(&self) -> SessionTokens {
        // 先累加各累计区间，再扣缓存；缓存占比变化不代表整个会话重置。
        SessionTokens::sum(self.finished.iter().chain(self.current.iter())).normalized_codex()
    }
}

fn take_tool(payload: &Value, details: &mut Details) {
    if matches!(
        payload["type"].as_str(),
        Some("function_call" | "custom_tool_call")
    ) {
        details.tool(&payload["call_id"], &payload["name"]);
    }
}
