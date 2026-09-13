use serde_json::Value;

use super::contracts::HistoryEntry;

pub(super) const MAX_ENTRY_BYTES: usize = 256 * 1024;
pub(super) const MAX_TOOLS: usize = 16;
pub(super) const MAX_CHANGES: usize = 32;
const MAX_FIELD_BYTES: usize = 64 * 1024;

pub(super) fn identity(value: Option<&str>, source: &str) -> String {
    value
        .filter(|value| !value.is_empty() && value.len() <= 512)
        .unwrap_or(source)
        .to_owned()
}

pub(super) fn content(value: &Value) -> (String, usize) {
    if let Some(text) = value.as_str() {
        return (text.to_owned(), 0);
    }
    let mut texts = Vec::new();
    let mut omitted = 0;
    for block in value.as_array().into_iter().flatten() {
        match block["type"].as_str() {
            Some("text" | "input_text" | "output_text") => {
                if let Some(text) = block["text"].as_str() {
                    texts.push(text);
                }
            }
            Some("tool_use" | "tool_result") => {}
            _ => omitted += 1,
        }
    }
    (texts.join("\n"), omitted)
}

pub(super) fn display(value: &Value) -> String {
    value.as_str().map(str::to_owned).unwrap_or_else(|| {
        if value.is_null() {
            String::new()
        } else {
            serde_json::to_string_pretty(value).unwrap_or_default()
        }
    })
}

pub(super) fn timestamp(value: &Value) -> Option<i64> {
    value
        .as_str()
        .and_then(crate::usage::timestamp::parse_rfc3339)
}

pub(super) fn bounded(mut entry: HistoryEntry) -> HistoryEntry {
    let mut remaining = MAX_ENTRY_BYTES;
    entry.truncated |= clip(&mut entry.text, &mut remaining);
    entry.truncated |= entry.tools.len() > MAX_TOOLS;
    entry.tools.truncate(MAX_TOOLS);
    for tool in &mut entry.tools {
        entry.truncated |= clip(&mut tool.name, &mut remaining);
        entry.truncated |= clip(&mut tool.text, &mut remaining);
        entry.truncated |= tool.changes.len() > MAX_CHANGES;
        tool.changes.truncate(MAX_CHANGES);
        for change in &mut tool.changes {
            entry.truncated |= clip(&mut change.path, &mut remaining);
            for field in [
                &mut change.original_path,
                &mut change.old_text,
                &mut change.new_text,
                &mut change.patch,
            ] {
                if let Some(text) = field {
                    entry.truncated |= clip(text, &mut remaining);
                }
            }
        }
    }
    entry
}

fn clip(text: &mut String, remaining: &mut usize) -> bool {
    let mut count = text.len().min(MAX_FIELD_BYTES).min(*remaining);
    while !text.is_char_boundary(count) {
        count -= 1;
    }
    let truncated = count < text.len();
    text.truncate(count);
    *remaining -= count;
    truncated
}
