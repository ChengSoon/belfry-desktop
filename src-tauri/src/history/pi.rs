//! 扫描 Pi 会话日志（`~/.pi/agent/sessions/--<path>--/<timestamp>_<id>.jsonl`）。
//!
//! 会话 id 在文件名里（`<timestamp>` 之后那一段，默认是 UUID）；每行是一条
//! AgentMessage，带 `role` 与 Unix 毫秒 `timestamp`。cwd 只被编码进目录名
//! （`/` → `-`，有损），不在记录里，所以这里不还原，留空。

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::agent::{AgentKind, AgentSessionRef};

use super::contracts::HistorySession;
use super::scan::{collect_jsonl_files, modified_epoch, normalize_title, pi_sessions_root};

const MAX_SCAN_LINES: usize = 4_000;

pub fn scan() -> Vec<HistorySession> {
    let Some(root) = pi_sessions_root() else {
        return Vec::new();
    };
    collect_jsonl_files(&root)
        .into_iter()
        .filter_map(|path| scan_file(&path))
        .collect()
}

/// 按会话 id 找文件：id 是文件名主干里 `_` 之后的那一段。
pub fn find_files(root: &Path, session_id: &str) -> Vec<PathBuf> {
    collect_jsonl_files(root)
        .into_iter()
        .filter(|path| session_id_from_path(path).as_deref() == Some(session_id))
        .collect()
}

pub(super) fn scan_file(path: &Path) -> Option<HistorySession> {
    scan_file_checked(path, &|| Ok(())).ok().flatten()
}

pub(super) fn scan_file_checked(
    path: &Path,
    check: super::line_reader::Check<'_>,
) -> Result<Option<HistorySession>, crate::terminal::AppError> {
    let last_active_at = modified_epoch(path);
    let mut meta = Meta::default();
    let request = super::scan::LineScan {
        path,
        max_lines: MAX_SCAN_LINES,
        check,
    };
    super::scan::read_lines_checked(request, |line| {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            return meta.done();
        };
        if meta.started_at.is_none() {
            meta.started_at = record_timestamp(&record);
        }
        if record["role"].as_str() == Some("user") {
            take_user(&record, &mut meta);
        }
        meta.done()
    })?;
    Ok(session_from_meta(path, meta, last_active_at))
}

pub(crate) fn session_id_from_path(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    stem.split_once('_').map(|(_, id)| id.to_string())
}

fn record_timestamp(record: &Value) -> Option<i64> {
    record["timestamp"].as_i64().map(|ms| ms / 1_000)
}

fn session_from_meta(path: &Path, meta: Meta, last_active_at: i64) -> Option<HistorySession> {
    let id = session_id_from_path(path)?;
    let session_ref = AgentSessionRef { agent: AgentKind::Pi, id };
    session_ref.validate().ok()?;
    Some(HistorySession {
        agent: AgentKind::Pi,
        id: session_ref.id.clone(),
        session_ref,
        title: meta.title.unwrap_or_default(),
        cwd: None,
        started_at: meta
            .started_at
            .or((last_active_at > 0).then_some(last_active_at)),
        last_active_at,
    })
}

fn take_user(record: &Value, meta: &mut Meta) {
    if meta.title.is_some() {
        return;
    }
    let content = &record["content"];
    if let Some(text) = content.as_str() {
        if !text.trim().is_empty() {
            meta.title = Some(normalize_title(text));
        }
        return;
    }
    let Some(parts) = content.as_array() else {
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
    started_at: Option<i64>,
    title: Option<String>,
}

impl Meta {
    fn done(&self) -> bool {
        self.title.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("belfry-history-pi-{tag}-{}", std::process::id()));
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
    fn extracts_id_title_and_start_time() {
        let root = temp_root("basic");
        let path = write_session(
            &root,
            "2026-09-17-10-30_019ff0d5-dbaf-7893-96db-4fbbbfee03a7.jsonl",
            &[
                r#"{"role":"system","content":"system prompt","timestamp":1758107400000}"#,
                r#"{"role":"user","content":"重构 auth 模块","timestamp":1758107410000}"#,
            ],
        );
        let session = scan_file(&path).unwrap();
        assert_eq!(session.agent, AgentKind::Pi);
        assert_eq!(session.session_ref.agent, AgentKind::Pi);
        assert_eq!(session.id, "019ff0d5-dbaf-7893-96db-4fbbbfee03a7");
        assert_eq!(session.title, "重构 auth 模块");
        assert_eq!(session.started_at, Some(1758107400));
        assert!(session.last_active_at > 0);
        assert!(session.cwd.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn content_blocks_are_joined_into_a_title() {
        let root = temp_root("blocks");
        let path = write_session(
            &root,
            "2026-09-17-10-30_019ff0d5-dbaf-7893-96db-4fbbbfee03a7.jsonl",
            &[r#"{"role":"user","content":[{"type":"text","text":"第一行"},{"type":"text","text":"第二行"}],"timestamp":1758107410000}"#],
        );
        let session = scan_file(&path).unwrap();
        assert_eq!(session.title, "第一行 第二行");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn find_files_matches_the_id_suffix() {
        let root = temp_root("find");
        let path = write_session(
            &root,
            "2026-09-17-10-30_019ff0d5-dbaf-7893-96db-4fbbbfee03a7.jsonl",
            &["{}"],
        );
        assert_eq!(
            find_files(&root, "019ff0d5-dbaf-7893-96db-4fbbbfee03a7"),
            vec![path]
        );
        assert!(find_files(&root, "nope").is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
