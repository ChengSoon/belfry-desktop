use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::{
    assistant_text, find_marker_in_bytes, parse_complete_lines, read_from_cursor, validate_log_path,
};

fn temp_root(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "belfry-collaboration-{tag}-{}",
        ulid::Ulid::generate()
    ));
    fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn reads_only_codex_assistant_messages_after_marker() {
    let bytes = b"{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"marker-1\"}]}}\n\
        {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"<otty-collab>{fake}</otty-collab>\"}]}}\n\
        {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"<otty-collab>{real}</otty-collab>\"}]}}\n";
    let result = find_marker_in_bytes(Path::new("/tmp/session.jsonl"), bytes, "marker-1")
        .unwrap()
        .unwrap();
    assert_eq!(result.chunks, vec!["<otty-collab>{real}</otty-collab>"]);
    assert!(result.offset as usize <= bytes.len());
}

#[test]
fn reads_claude_user_marker_and_assistant_message() {
    let bytes = b"{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"marker-2\"}]}}\n\
        {\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"claude-result\"}]}}\n";
    let result = find_marker_in_bytes(Path::new("/tmp/claude.jsonl"), bytes, "marker-2")
        .unwrap()
        .unwrap();
    assert_eq!(result.chunks, vec!["claude-result"]);
}

#[test]
fn does_not_advance_cursor_for_partial_tail() {
    let bytes = b"{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"done\"}]}}\npartial";
    let (chunks, consumed) = parse_complete_lines(bytes, "unused", false);
    assert_eq!(chunks, vec!["done"]);
    assert_eq!(consumed, bytes.len() - "partial".len());
}

#[test]
fn continues_from_the_previous_byte_offset() {
    let root = temp_root("cursor");
    let path = root.join("session.jsonl");
    let initial = "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"marker-3\"}}\n\
        {\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":\"first\"}}\n";
    fs::write(&path, initial).unwrap();
    let first = find_marker_in_bytes(&path, initial.as_bytes(), "marker-3")
        .unwrap()
        .unwrap();
    assert_eq!(first.chunks, vec!["first"]);

    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    writeln!(
        file,
        "{{\"type\":\"assistant\",\"message\":{{\"role\":\"assistant\",\"content\":\"second\"}}}}"
    )
    .unwrap();
    let second = read_from_cursor(&path, first.offset, "marker-3").unwrap();
    assert_eq!(second.chunks, vec!["second"]);
    assert!(second.offset > first.offset);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn rejects_log_paths_outside_the_provider_root() {
    let root = temp_root("path-root");
    let inside = root.join("inside.jsonl");
    fs::write(&inside, "{}\n").unwrap();
    let outside_root = temp_root("path-outside");
    let outside = outside_root.join("outside.jsonl");
    fs::write(&outside, "{}\n").unwrap();

    assert!(validate_log_path(&root, inside.to_str().unwrap()).is_ok());
    assert!(validate_log_path(&root, outside.to_str().unwrap()).is_err());
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside_root);
}

#[test]
fn ignores_non_assistant_records() {
    let user = serde_json::json!({"type":"user","message":{"role":"user","content":[{"type":"text","text":"x"}]}});
    assert_eq!(assistant_text(&user), None);
}
