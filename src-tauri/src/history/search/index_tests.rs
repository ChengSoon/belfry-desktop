use super::fixtures::{codex_log, query, Fixture};
use super::{HistoryIndex, SearchCancellation};
use crate::agent::AgentKind;
use serde_json::json;
use std::fs;
use std::io::Write;

#[test]
fn finds_body_text_and_preserves_resume_identity_and_original_file() {
    let fixture = Fixture::new();
    let path = fixture.write(
        "codex/a.jsonl",
        &codex_log("session-a", "/work/项目", "修改 src/接口.rs 完成"),
    );
    let before = fs::read(&path).unwrap();
    let report = HistoryIndex::default()
        .search(
            &query("src/接口.rs"),
            &fixture.roots,
            &SearchCancellation::default(),
        )
        .unwrap();
    assert_eq!(1, report.hits.len());
    assert_eq!("session-a", report.hits[0].session.session_ref.id);
    assert_eq!("开始开发", report.hits[0].session.title);
    assert!(report.hits[0]
        .snippet
        .as_deref()
        .unwrap()
        .contains("src/接口.rs"));
    assert_eq!(before, fs::read(path).unwrap());
}

#[test]
fn combines_agent_project_and_inclusive_start_exclusive_end_filters() {
    let fixture = Fixture::new();
    let path = fixture.write(
        "codex/a.jsonl",
        &codex_log("a", "C:\\项目\\应用", "检查 SEARCH"),
    );
    fixture.write(
        "codex/b.jsonl",
        &codex_log("b", "C:\\项目\\应用-old", "检查 SEARCH"),
    );
    let moment = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000);
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(moment))
        .unwrap();
    let mut request = query("search");
    request.agent = Some(AgentKind::Codex);
    request.project_root = Some("c:/项目/应用/".into());
    request.from = Some(1_000);
    request.until = Some(1_001);
    let mut index = HistoryIndex::default();
    let report = index
        .search(&request, &fixture.roots, &SearchCancellation::default())
        .unwrap();
    assert_eq!(
        vec!["a"],
        report
            .hits
            .iter()
            .map(|hit| hit.session.id.as_str())
            .collect::<Vec<_>>()
    );
    request.until = Some(1_000);
    request.from = None;
    assert!(index
        .search(&request, &fixture.roots, &SearchCancellation::default())
        .unwrap()
        .hits
        .is_empty());
}

#[test]
fn merges_codex_resume_parts_without_merging_other_agents_with_the_same_id() {
    let fixture = Fixture::new();
    fixture.write(
        "codex/a.jsonl",
        &codex_log("same", "/work/a", "第一次独有信息"),
    );
    fixture.write(
        "codex/b.jsonl",
        &codex_log("same", "/work/a", "续写时独有信息"),
    );
    let claude = json!({"type":"user","cwd":"/work/b","message":{"content":"续写时独有信息"}});
    fixture.write("claude/same.jsonl", &format!("{claude}\n"));
    let mut index = HistoryIndex::default();
    let all = index
        .search(&query(""), &fixture.roots, &SearchCancellation::default())
        .unwrap();
    assert_eq!(2, all.hits.len());
    let matching = index
        .search(
            &query("续写时独有信息"),
            &fixture.roots,
            &SearchCancellation::default(),
        )
        .unwrap();
    assert_eq!(2, matching.hits.len());
    assert!(matching
        .hits
        .iter()
        .any(|hit| hit.session.agent == AgentKind::Claude));
    assert!(matching
        .hits
        .iter()
        .any(|hit| hit.session.agent == AgentKind::Codex));
}

#[test]
fn caches_unchanged_files_and_reindexes_after_append_or_removal() {
    let fixture = Fixture::new();
    let path = fixture.write("codex/a.jsonl", &codex_log("a", "/work/a", "旧内容"));
    let cancel = SearchCancellation::default();
    let mut index = HistoryIndex::default();
    assert_eq!(
        1,
        index
            .search(&query("旧内容"), &fixture.roots, &cancel)
            .unwrap()
            .indexed_files
    );
    assert_eq!(
        0,
        index
            .search(&query("旧内容"), &fixture.roots, &cancel)
            .unwrap()
            .indexed_files
    );
    let extra = json!({"type":"event_msg","payload":{"type":"agent_message","message":"追加内容"}});
    writeln!(
        fs::OpenOptions::new().append(true).open(&path).unwrap(),
        "{extra}"
    )
    .unwrap();
    let refreshed = index
        .search(&query("追加内容"), &fixture.roots, &cancel)
        .unwrap();
    assert_eq!(1, refreshed.indexed_files);
    assert_eq!(1, refreshed.hits.len());
    fs::remove_file(path).unwrap();
    assert!(index
        .search(&query("旧内容"), &fixture.roots, &cancel)
        .unwrap()
        .hits
        .is_empty());
}

#[test]
fn malformed_lines_do_not_hide_later_messages_and_are_reported() {
    let fixture = Fixture::new();
    let mut content = codex_log("a", "/work/a", "普通消息");
    content.push_str("{broken}\n");
    content.push_str(&format!(
        "{}\n",
        json!({"type":"event_msg","payload":{"type":"agent_message","message":"坏行后面的消息"}})
    ));
    fixture.write("codex/a.jsonl", &content);
    let report = HistoryIndex::default()
        .search(
            &query("坏行后面"),
            &fixture.roots,
            &SearchCancellation::default(),
        )
        .unwrap();
    assert_eq!(1, report.hits.len());
    assert_eq!(1, report.skipped_lines);
}

#[test]
fn date_filters_use_latest_resume_part_even_when_only_an_old_part_matches() {
    let fixture = Fixture::new();
    let old = fixture.write(
        "codex/a.jsonl",
        &codex_log("same", "/work/a", "早期搜索目标"),
    );
    let recent = fixture.write(
        "codex/b.jsonl",
        &codex_log("same", "/work/a", "新的无关消息"),
    );
    for (path, epoch) in [(old, 1_000), (recent, 2_000)] {
        let moment = std::time::UNIX_EPOCH + std::time::Duration::from_secs(epoch);
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(moment))
            .unwrap();
    }
    let mut request = query("早期搜索目标");
    request.from = Some(1_500);
    let report = HistoryIndex::default()
        .search(&request, &fixture.roots, &SearchCancellation::default())
        .unwrap();
    assert_eq!(1, report.hits.len());
    assert_eq!(2_000, report.hits[0].session.last_active_at);
}
