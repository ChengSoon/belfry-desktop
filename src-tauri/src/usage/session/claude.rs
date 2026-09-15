use super::{
    contracts::SessionTokens,
    details::{Details, text},
};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct ClaudeUsage {
    messages: HashMap<(String, String), SessionTokens>,
    pub incomplete: bool,
}

impl ClaudeUsage {
    pub fn consume(&mut self, record: &Value, details: &mut Details) {
        if record["type"] != "assistant" || record["message"]["model"] == "<synthetic>" {
            return;
        }
        let message = &record["message"];
        details.model(&message["model"]);
        self.usage(record);
        for part in message["content"].as_array().into_iter().flatten() {
            if part["type"] == "tool_use" {
                details.tool(&part["id"], &part["name"]);
            }
        }
    }

    fn usage(&mut self, record: &Value) {
        let usage = &record["message"]["usage"];
        if !usage.is_object() {
            return;
        }
        let Some(id) = text(&record["message"]["id"]) else {
            self.incomplete = true;
            return;
        };
        let key = (
            id.into(),
            text(&record["requestId"]).unwrap_or_default().into(),
        );
        let next = SessionTokens::claude(usage);
        self.messages
            .entry(key)
            .and_modify(|previous| previous.maximum(&next))
            .or_insert(next);
    }

    pub fn tokens(&self) -> SessionTokens {
        if self.incomplete {
            return SessionTokens::default();
        }
        SessionTokens::sum(self.messages.values())
    }
}
