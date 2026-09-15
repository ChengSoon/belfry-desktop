use serde_json::json;
use std::fs;
use std::time::{Duration, UNIX_EPOCH};

use super::cancellation::SearchRegistry;
use super::fixtures::{codex_log, query, Fixture};
use super::{HistoryIndex, SearchCancellation};
use crate::history::line_reader::MAX_LINE_BYTES;

#[test]
fn replacing_a_file_with_equal_length_text_invalidates_the_cached_result() {
    let fixture = Fixture::new();
    let before = codex_log("a", "/work/a", "旧内容");
    let after = codex_log("a", "/work/a", "新内容");
    assert_eq!(before.len(), after.len());
    let path = fixture.write("codex/a.jsonl", &before);
    let cancel = SearchCancellation::default();
    let mut index = HistoryIndex::default();
    assert_eq!(
        1,
        index
            .search(&query("旧内容"), &fixture.roots, &cancel)
            .unwrap()
            .hits
            .len()
    );
    fs::write(&path, after).unwrap();
    let time = UNIX_EPOCH + Duration::from_secs(10_000);
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(time))
        .unwrap();
    let current = index
        .search(&query("新内容"), &fixture.roots, &cancel)
        .unwrap();
    assert_eq!(1, current.indexed_files);
    assert_eq!(1, current.hits.len());
    assert!(index
        .search(&query("旧内容"), &fixture.roots, &cancel)
        .unwrap()
        .hits
        .is_empty());
}

#[test]
fn an_oversized_line_does_not_hide_later_search_results() {
    let fixture = Fixture::new();
    let mut content = codex_log("a", "/work/a", "普通消息");
    content.push_str(&"x".repeat(MAX_LINE_BYTES as usize + 10));
    content.push('\n');
    content.push_str(&format!(
        "{}\n",
        json!({"type":"event_msg","payload":{
            "type":"agent_message","message":"超长行之后的目标"
        }})
    ));
    fixture.write("codex/a.jsonl", &content);
    let report = HistoryIndex::default()
        .search(
            &query("超长行之后"),
            &fixture.roots,
            &SearchCancellation::default(),
        )
        .unwrap();
    assert_eq!(1, report.hits.len());
    assert_eq!(1, report.skipped_lines);
}

#[test]
fn a_cancelled_search_never_returns_a_partial_report() {
    let fixture = Fixture::new();
    fixture.write("codex/a.jsonl", &codex_log("a", "/work/a", "目标"));
    let registry = SearchRegistry::default();
    let cancel = registry.begin("request".into()).unwrap();
    registry.cancel("request");
    assert!(HistoryIndex::default()
        .search(&query("目标"), &fixture.roots, &cancel)
        .is_err());
}
