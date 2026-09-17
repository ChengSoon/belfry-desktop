//! Pi 的会话用量：assistant 消息里带的 `usage`（input / output / cacheRead / cacheWrite）。
//!
//! Pi 的每条 assistant 消息都带 provider、model 与 usage，工具调用是 content 里的
//! `toolCall` 块，和 Claude/Codex 的日志结构都不同。

use super::{
    contracts::SessionTokens,
    details::Details,
};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct PiUsage {
    messages: HashMap<String, SessionTokens>,
}

impl PiUsage {
    pub fn consume(&mut self, record: &Value, details: &mut Details) {
        if record["role"].as_str() != Some("assistant") {
            return;
        }
        if record["model"].as_str().is_none_or(|model| model == "<synthetic>") {
            return;
        }
        details.model(&record["model"]);
        if let Some(ms) = record["timestamp"].as_i64() {
            details.updated_at = details.updated_at.max(Some(ms / 1_000));
        }
        if let Some(id) = record["id"].as_str() {
            let next = SessionTokens::pi(&record["usage"]);
            self.messages
                .entry(id.to_string())
                .and_modify(|previous| previous.maximum(&next))
                .or_insert(next);
        }
        for block in record["content"].as_array().into_iter().flatten() {
            if block["type"].as_str() == Some("toolCall") {
                details.tool(&block["id"], &block["name"]);
            }
        }
    }

    pub fn tokens(&self) -> SessionTokens {
        SessionTokens::sum(self.messages.values())
    }
}
