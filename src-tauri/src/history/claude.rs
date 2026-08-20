//! 扫描 Claude Code 会话日志（`~/.claude/projects/**/*.jsonl`）。
//!
//! 目录名是 cwd 的编码形式（`/` → `-`），解码不可靠（目录名本身可能含 `-`），
//! 所以 cwd 直接从第一条 user 记录的 `cwd` 字段读。会话 id 就是文件名主干。

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::agent::{AgentKind, AgentSessionRef};
use crate::usage::timestamp::parse_rfc3339;

use super::contracts::HistorySession;
use super::scan::{
    claude_sessions_root, collect_jsonl_files, modified_epoch, normalize_title, read_lines_until,
};

const MAX_SCAN_LINES: usize = 4_000;

pub fn scan() -> Vec<HistorySession> {
    let Some(root) = claude_sessions_root() else {
        return Vec::new();
    };
    collect_jsonl_files(&root)
        .into_iter()
        .filter_map(|path| scan_file(&path))
        .collect()
}

/// 按会话 id 找文件：Claude 的 id 就是文件名主干，不需要读内容。
/// 一个 id 至多对应一个文件，返回 Vec 只为与 codex 的签名对齐。
pub fn find_files(root: &Path, session_id: &str) -> Vec<PathBuf> {
    collect_jsonl_files(root)
        .into_iter()
        .filter(|path| path.file_stem().and_then(|v| v.to_str()) == Some(session_id))
        .collect()
}

fn scan_file(path: &Path) -> Option<HistorySession> {
    let last_active_at = modified_epoch(path);
    let id = path.file_stem()?.to_str()?.to_string();
    let mut meta = Meta::default();
    read_lines_until(path, MAX_SCAN_LINES, |line| {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            return meta.done();
        };
        if record["type"].as_str() == Some("user") {
            take_user(&record, &mut meta);
        }
        meta.done()
    });

    let session_ref = AgentSessionRef {
        agent: AgentKind::Claude,
        id,
    };
    session_ref.validate().ok()?;
    Some(HistorySession {
        agent: AgentKind::Claude,
        id: session_ref.id.clone(),
        session_ref,
        title: meta.title.unwrap_or_default(),
        cwd: meta.cwd,
        started_at: meta
            .started_at
            .or((last_active_at > 0).then_some(last_active_at)),
        last_active_at,
    })
}

fn take_user(record: &Value, meta: &mut Meta) {
    if meta.cwd.is_none() {
        meta.cwd = record["cwd"].as_str().map(str::to_string);
    }
    if meta.started_at.is_none() {
        meta.started_at = record["timestamp"].as_str().and_then(parse_rfc3339);
    }
    if meta.title.is_some() {
        return;
    }
    let Some(parts) = record["message"]["content"].as_array() else {
        return;
    };
    let text = parts
        .iter()
        .filter(|part| part["type"].as_str() == Some("text"))
        .map(|part| part["text"].as_str().unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return;
    }
    meta.title = Some(normalize_title(&text));
}

#[derive(Default)]
struct Meta {
    cwd: Option<String>,
    started_at: Option<i64>,
    title: Option<String>,
}

impl Meta {
    fn done(&self) -> bool {
        self.cwd.is_some() && self.title.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "belfry-history-claude-{tag}-{}",
            std::process::id()
        ));
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
    fn extracts_id_cwd_title_and_start_time() {
        let root = temp_root("basic");
        let path = write_session(
            &root,
            "cf32a9a3-0a60-427b-8bba-823e36c66d13.jsonl",
            &[
                r#"{"type":"mode","mode":"normal","sessionId":"cf32a9a3-0a60-427b-8bba-823e36c66d13"}"#,
                r#"{"type":"user","cwd":"/work/a","timestamp":"2026-07-29T02:36:31.744Z","sessionId":"cf32a9a3-0a60-427b-8bba-823e36c66d13","message":{"role":"user","content":[{"type":"text","text":"注册的账号是什么原因"}]}}"#,
            ],
        );
        let session = scan_file(&path).unwrap();
        assert_eq!(session.agent, AgentKind::Claude);
        assert_eq!(session.session_ref.agent, AgentKind::Claude);
        assert_eq!(session.session_ref.id, session.id);
        assert_eq!(session.id, "cf32a9a3-0a60-427b-8bba-823e36c66d13");
        assert_eq!(session.cwd.as_deref(), Some("/work/a"));
        assert_eq!(session.title, "注册的账号是什么原因");
        assert_eq!(
            session.started_at,
            parse_rfc3339("2026-07-29T02:36:31.744Z")
        );
        assert!(session.last_active_at > 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn image_only_first_message_still_yields_title() {
        let root = temp_root("image");
        let path = write_session(
            &root,
            "cf32a9a3-0a60-427b-8bba-823e36c66d13.jsonl",
            &[
                r#"{"type":"user","cwd":"/work/a","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"xx"}}]}}"#,
                r#"{"type":"user","cwd":"/work/a","message":{"role":"user","content":[{"type":"text","text":"这张图里是什么"}]}}"#,
            ],
        );
        let session = scan_file(&path).unwrap();
        assert_eq!(session.title, "这张图里是什么");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn find_file_matches_by_stem() {
        let root = temp_root("find");
        let path = write_session(&root, "abc-123.jsonl", &[r#"{}"#]);
        assert_eq!(find_files(&root, "abc-123"), vec![path]);
        assert!(find_files(&root, "nope").is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
