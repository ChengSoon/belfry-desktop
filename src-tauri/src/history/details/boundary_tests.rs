use super::{
    cursor::MAX_LINE_BYTES,
    fixtures::{Fixture, claude_message},
};
use crate::agent::AgentKind;
use serde_json::json;

#[test]
fn page_byte_boundaries_preserve_partial_json_and_pending_entries() {
    let fixture = Fixture::new();
    let messages: Vec<_> = (0..12)
        .map(|index| {
            claude_message(
                &index.to_string(),
                &format!("{index}:{}", "文".repeat(MAX_LINE_BYTES / 4)),
            )
        })
        .collect();
    fixture.write("native.jsonl", &messages);
    let mut reader = fixture.reader(AgentKind::Claude);
    let mut entries = Vec::new();
    for index in 0..20 {
        let page = reader.page(index).unwrap();
        assert_eq!(0, page.skipped_lines);
        let more = page.has_more;
        entries.extend(page.entries);
        if !more {
            break;
        }
    }
    assert_eq!(12, entries.len());
    for (index, entry) in entries.iter().enumerate() {
        assert!(entry.text.starts_with(&format!("{index}:")));
    }
}

#[test]
fn tool_payload_budget_carries_the_next_record_without_losing_or_duplicating_it() {
    let fixture = Fixture::new();
    let messages: Vec<_> = (0..14).map(|index| json!({"type":"assistant","uuid":format!("tool-{index}"),"message":{"content":[{
        "type":"tool_use","id":format!("tool-{index}"),"name":"Write","input":{"file_path":format!("{index}.txt"),"content":"a".repeat(64 * 1024)}
    }]}})).collect();
    fixture.write("native.jsonl", &messages);
    let mut reader = fixture.reader(AgentKind::Claude);
    let mut paths = Vec::new();
    for index in 0..10 {
        let page = reader.page(index).unwrap();
        assert!(serde_json::to_vec(&page).unwrap().len() < 600 * 1024);
        let more = page.has_more;
        paths.extend(
            page.entries
                .into_iter()
                .flat_map(|entry| entry.tools)
                .flat_map(|tool| tool.changes)
                .map(|change| change.path),
        );
        if !more {
            break;
        }
    }
    assert_eq!(
        (0..14)
            .map(|index| format!("{index}.txt"))
            .collect::<Vec<_>>(),
        paths
    );
}

#[test]
fn updated_records_with_the_same_native_uuid_keep_unique_message_targets() {
    let fixture = Fixture::new();
    fixture.write(
        "native.jsonl",
        &[
            claude_message("same", "片段一"),
            claude_message("same", "片段二"),
        ],
    );
    let page = fixture.reader(AgentKind::Claude).page(0).unwrap();
    assert_eq!(2, page.entries.len());
    assert_ne!(page.entries[0].id, page.entries[1].id);
}
