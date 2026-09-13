use super::contracts::ToolStatistics;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};

#[derive(Default)]
pub(super) struct Details {
    pub models: BTreeSet<String>,
    pub current_model: Option<String>,
    pub updated_at: Option<i64>,
    pub incomplete_tools: bool,
    tools: HashMap<String, String>,
}

impl Details {
    pub fn model(&mut self, value: &Value) {
        if let Some(model) = text(value).filter(|model| *model != "<synthetic>") {
            self.models.insert(model.into());
            self.current_model = Some(model.into());
        }
    }

    pub fn tool(&mut self, id: &Value, name: &Value) {
        let Some((id, name)) = text(id).zip(text(name)) else {
            self.incomplete_tools = true;
            return;
        };
        self.tools.insert(id.into(), name.into());
    }

    pub fn timestamp(&mut self, record: &Value) {
        let at = record["timestamp"]
            .as_str()
            .and_then(crate::usage::timestamp::parse_rfc3339);
        self.updated_at = self.updated_at.max(at);
    }

    pub fn tool_report(&self) -> Vec<ToolStatistics> {
        let mut by_name: BTreeMap<String, u64> = BTreeMap::new();
        for name in self.tools.values() {
            *by_name.entry(name.clone()).or_default() += 1;
        }
        let mut result: Vec<_> = by_name
            .into_iter()
            .map(|(name, calls)| ToolStatistics { name, calls })
            .collect();
        result.sort_by(|left, right| {
            right
                .calls
                .cmp(&left.calls)
                .then(left.name.cmp(&right.name))
        });
        result
    }

    pub fn tool_count(&self) -> Option<u64> {
        (!self.incomplete_tools).then_some(self.tools.len() as u64)
    }
}

pub(super) fn text(value: &Value) -> Option<&str> {
    const MAX_LABEL_BYTES: usize = 1024;
    value.as_str().filter(|text| {
        !text.is_empty() && text.len() <= MAX_LABEL_BYTES && !text.chars().any(char::is_control)
    })
}
