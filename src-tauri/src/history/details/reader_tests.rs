use super::{
    cancel::Cancellation,
    fixtures::{Fixture, claude_message, codex_message, meta, request},
    reader::{DetailReader, PAGE_ENTRIES},
};
use crate::agent::AgentKind;
use serde_json::json;

#[test]
fn pages_are_bounded_ordered_retryable_and_leave_original_bytes_unchanged() {
    let fixture = Fixture::new();
    let messages: Vec<_> = (0..PAGE_ENTRIES + 5)
        .map(|index| claude_message(&format!("message-{index}"), &format!("内容 {index}")))
        .collect();
    let path = fixture.write("project/native.jsonl", &messages);
    let before = std::fs::read(&path).unwrap();
    let mut reader = fixture.reader(AgentKind::Claude);
    let first = reader.page(0).unwrap();
    assert_eq!(PAGE_ENTRIES, first.entries.len());
    assert!(first.has_more);
    let retry = reader.page(0).unwrap();
    assert_eq!(first.scanned_bytes, retry.scanned_bytes);
    assert_eq!(first.entries[0].id, retry.entries[0].id);
    let second = reader.page(1).unwrap();
    assert_eq!(5, second.entries.len());
    assert_eq!(format!("内容 {PAGE_ENTRIES}"), second.entries[0].text);
    assert!(!second.has_more);
    assert_eq!(before.len() as u64, second.scanned_bytes);
    assert_eq!(before, std::fs::read(path).unwrap());
}

#[test]
fn oversized_lines_continue_across_pages_and_do_not_hide_following_messages() {
    let fixture = Fixture::new();
    let path = fixture.root.join("native.jsonl");
    let long = "x".repeat(5 * 1024 * 1024);
    std::fs::write(
        &path,
        format!("{long}\n{}", claude_message("next", "超长行之后")),
    )
    .unwrap();
    let mut reader = fixture.reader(AgentKind::Claude);
    let first = reader.page(0).unwrap();
    assert!(first.has_more);
    assert!(first.entries.is_empty());
    assert_eq!(4 * 1024 * 1024, first.scanned_bytes);
    let second = reader.page(1).unwrap();
    assert_eq!("超长行之后", second.entries[0].text);
    assert_eq!(1, second.skipped_lines);
    assert!(!second.has_more);
}

#[test]
fn malformed_records_are_visible_and_complete_final_lines_need_no_newline() {
    let fixture = Fixture::new();
    let path = fixture.root.join("native.jsonl");
    std::fs::write(
        &path,
        format!("broken json\n{}", claude_message("last", "完整的末行")),
    )
    .unwrap();
    let page = fixture.reader(AgentKind::Claude).page(0).unwrap();
    assert_eq!(1, page.skipped_lines);
    assert_eq!("完整的末行", page.entries[0].text);
    assert!(!page.has_more);
}

#[test]
fn replaced_or_appended_logs_require_refresh_instead_of_mixing_versions() {
    let fixture = Fixture::new();
    let values: Vec<_> = (0..PAGE_ENTRIES + 1)
        .map(|index| claude_message(&index.to_string(), "旧内容"))
        .collect();
    let path = fixture.write("native.jsonl", &values);
    let mut reader = fixture.reader(AgentKind::Claude);
    reader.page(0).unwrap();
    let changed = std::fs::read_to_string(&path)
        .unwrap()
        .replace("旧内容", "新内容");
    std::fs::write(&path, changed).unwrap();
    assert!(reader.page(1).unwrap_err().message.contains("已变化"));
    let mut reader = fixture.reader(AgentKind::Claude);
    reader.page(0).unwrap();
    use std::io::Write;
    writeln!(std::fs::OpenOptions::new().append(true).open(path).unwrap()).unwrap();
    assert!(reader.page(1).is_err());
}

#[test]
fn finds_codex_resume_shards_by_metadata_and_rejects_foreign_records() {
    let fixture = Fixture::new();
    fixture.write(
        "2026/01/imported.jsonl",
        &[
            meta("native"),
            codex_message("第一段"),
            meta("other"),
            codex_message("外来内容"),
        ],
    );
    fixture.write(
        "2026/02/continued.jsonl",
        &[meta("native"), codex_message("第二段")],
    );
    fixture.write(
        "2026/03/foreign.jsonl",
        &[meta("other"), codex_message("其他会话")],
    );
    let page = fixture.reader(AgentKind::Codex).page(0).unwrap();
    let texts: Vec<_> = page
        .entries
        .iter()
        .map(|entry| entry.text.as_str())
        .collect();
    assert_eq!(vec!["第一段", "第二段"], texts);
}

#[test]
fn duplicate_ids_and_codex_echoes_are_removed_but_repeated_user_prompts_remain() {
    let fixture = Fixture::new();
    let duplicate = claude_message("same", "重复记录");
    fixture.write(
        "native.jsonl",
        &[
            duplicate.clone(),
            duplicate,
            claude_message("new", "重复记录"),
        ],
    );
    assert_eq!(
        2,
        fixture
            .reader(AgentKind::Claude)
            .page(0)
            .unwrap()
            .entries
            .len()
    );
    fixture.write(
        "codex.jsonl",
        &[
            meta("native"),
            json!({"type":"event_msg","payload":{"type":"user_message","message":"同一条提示"}}),
            codex_message("同一条提示"),
            codex_message("同一条提示"),
        ],
    );
    assert_eq!(
        2,
        fixture
            .reader(AgentKind::Codex)
            .page(0)
            .unwrap()
            .entries
            .len()
    );
}

#[test]
fn closing_or_cancelling_a_reader_stops_its_work() {
    let fixture = Fixture::new();
    fixture.write("native.jsonl", &[claude_message("one", "你好")]);
    let cancel = Cancellation::default();
    let mut reader =
        DetailReader::open(request(AgentKind::Claude), &fixture.root, cancel.clone()).unwrap();
    cancel.cancel();
    assert!(reader.page(0).is_err());
    assert!(DetailReader::open(request(AgentKind::Claude), &fixture.root, cancel).is_err());
}

#[cfg(unix)]
#[test]
fn external_symlinks_and_links_replaced_after_open_cannot_supply_detail_content() {
    use std::os::unix::fs::symlink;
    let outside = Fixture::new();
    let outside_file = outside.write("secret.jsonl", &[claude_message("secret", "不应读取")]);
    let fixture = Fixture::new();
    let link = fixture.root.join("native.jsonl");
    symlink(&outside_file, &link).unwrap();
    assert!(
        fixture
            .reader(AgentKind::Claude)
            .page(0)
            .unwrap()
            .entries
            .is_empty()
    );
    std::fs::remove_file(&link).unwrap();
    fixture.write("native.jsonl", &[claude_message("inside", "内部日志")]);
    let mut reader = fixture.reader(AgentKind::Claude);
    std::fs::remove_file(&link).unwrap();
    symlink(outside_file, link).unwrap();
    assert!(reader.page(0).is_err());
}
