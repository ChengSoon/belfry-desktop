use super::*;

fn temp_root(tag: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("belfry-history-codex-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_session(root: &Path, name: &str, lines: &[&str]) -> PathBuf {
    let path = root.join(name);
    std::fs::write(&path, lines.join("\n")).unwrap();
    path
}

#[test]
fn extracts_id_cwd_and_real_user_title() {
    let root = temp_root("basic");
    let path = write_session(
        &root,
        "rollout-2026-08-11T20-39-35-019ff0d5-dbaf-7893-96db-4fbbbfee03a7.jsonl",
        &[
            r#"{"timestamp":"2026-08-11T12:40:40Z","type":"session_meta","payload":{"session_id":"019ff0d5-dbaf-7893-96db-4fbbbfee03a7","cwd":"/work/a","timestamp":"2026-08-11T12:39:35Z"}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"帮我看看这个 bug"}]}}"#,
        ],
    );
    let session = scan_file(&path).unwrap();
    assert_eq!(session.agent, AgentKind::Codex);
    assert_eq!(session.session_ref.agent, AgentKind::Codex);
    assert_eq!(session.session_ref.id, session.id);
    assert_eq!(session.id, "019ff0d5-dbaf-7893-96db-4fbbbfee03a7");
    assert_eq!(session.cwd.as_deref(), Some("/work/a"));
    assert_eq!(session.title, "帮我看看这个 bug");
    assert_eq!(session.started_at, parse_rfc3339("2026-08-11T12:39:35Z"));
    assert!(session.last_active_at > 0);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn skips_injected_instructions_for_title() {
    let root = temp_root("injected");
    let path = write_session(
        &root,
        "rollout-2026-08-11T20-39-35-019ff0d5-dbaf-7893-96db-4fbbbfee03a7.jsonl",
        &[
            r#"{"type":"session_meta","payload":{"session_id":"019ff0d5-dbaf-7893-96db-4fbbbfee03a7","cwd":"/work/a"}}"#,
            r##"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions\n\n<INSTRUCTIONS>long injected block"}]}}"##,
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"真正的问题在这里"}]}}"#,
        ],
    );
    let session = scan_file(&path).unwrap();
    assert_eq!(session.title, "真正的问题在这里");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn falls_back_to_filename_when_meta_is_missing() {
    let root = temp_root("fallback");
    let path = write_session(
        &root,
        "rollout-2026-08-11T20-39-35-019ff0d5-dbaf-7893-96db-4fbbbfee03a7.jsonl",
        &[
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"你好"}]}}"#,
        ],
    );
    let session = scan_file(&path).unwrap();
    assert_eq!(session.id, "019ff0d5-dbaf-7893-96db-4fbbbfee03a7");
    assert_eq!(session.cwd, None);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn find_files_matches_by_meta_id_and_filename_uuid() {
    let root = temp_root("find");
    let path = write_session(
        &root,
        "rollout-2026-08-11T20-39-35-019ff0d5-dbaf-7893-96db-4fbbbfee03a7.jsonl",
        &[
            r#"{"type":"session_meta","payload":{"session_id":"019ff0d5-dbaf-7893-96db-4fbbbfee03a7"}}"#,
        ],
    );
    assert_eq!(
        find_files(&root, "019ff0d5-dbaf-7893-96db-4fbbbfee03a7"),
        vec![path]
    );
    assert!(find_files(&root, "missing").is_empty());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn resumed_session_deduplicates_keeping_earliest_title_and_latest_mtime() {
    let root = temp_root("dedupe");
    // 同一 session_id 的两个分片：续写文件更新，但首条用户消息是注入的 resume 提示。
    write_session(
        &root,
        "rollout-2026-08-11T20-39-35-019ff0d5-dbaf-7893-96db-4fbbbfee03a7.jsonl",
        &[
            r#"{"type":"session_meta","payload":{"session_id":"019ff0d5-dbaf-7893-96db-4fbbbfee03a7","cwd":"/work/a"}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"最初的提问"}]}}"#,
        ],
    );
    let resumed = write_session(
        &root,
        "rollout-2026-08-11T22-04-36-019ff0d5-dbaf-7893-96db-4fbbbfee03a8.jsonl",
        &[
            r#"{"type":"session_meta","payload":{"session_id":"019ff0d5-dbaf-7893-96db-4fbbbfee03a7","cwd":"/work/a"}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"The following is the Codex agent history"}]}}"#,
        ],
    );
    // 续写分片更新一些，保证它的 mtime 更晚。
    let later = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 60;
    let _ = filetime_set_mtime(&resumed, later);

    let sessions = scan_in(&root);
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "019ff0d5-dbaf-7893-96db-4fbbbfee03a7");
    assert_eq!(sessions[0].title, "最初的提问");
    assert_eq!(sessions[0].last_active_at, later);
    assert_eq!(
        find_files(&root, "019ff0d5-dbaf-7893-96db-4fbbbfee03a7").len(),
        2
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// 测试里直接写 mtime：unix 上用 `touch -d` 也行，但这里不依赖外部命令。
fn filetime_set_mtime(path: &Path, epoch_seconds: i64) -> std::io::Result<()> {
    let time =
        std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(epoch_seconds as u64);
    let file = std::fs::File::options().write(true).open(path)?;
    file.set_times(std::fs::FileTimes::new().set_modified(time))
}
