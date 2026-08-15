//! 扫描 Codex 会话日志（`~/.codex/sessions/**/*.jsonl`）。
//!
//! 文件名形如 `rollout-<时间戳>-<uuid>.jsonl`，权威的 session_id 在首行
//! `session_meta` 里（与文件名 uuid 一致，读不到时退回文件名末段）。
//! 标题取第一条"够格"的用户消息：跳过系统注入的 instructions 块，
//! 否则列表里会刷出一整片一模一样的 `# AGENTS.md instructions`。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::usage::timestamp::parse_rfc3339;

use super::contracts::HistorySession;
use super::scan::{
    codex_sessions_root, collect_jsonl_files, modified_epoch, normalize_title, read_lines_until,
};

/// 系统注入的上下文块。它们会以用户角色写进日志，但不是真实提问。
const INJECTED_PREFIXES: [&str; 6] = [
    "# AGENTS.md",
    "# SYSTEM",
    "# Environment",
    "<skills_instructions>",
    "<permissions instructions>",
    "<collaboration_mode>",
];

const MAX_SCAN_LINES: usize = 4_000;

/// 一个会话被 resume 续写时会拆成多个 rollout 文件，但共享同一个 session_id。
/// 列表按 id 去重：保留最早文件的标题 / 目录（更接近会话主题），
/// 最后活跃时间取所有分片里最新的，让"继续会话"能排到最前。
pub fn scan() -> Vec<HistorySession> {
    codex_sessions_root()
        .as_deref()
        .map(scan_in)
        .unwrap_or_default()
}

fn scan_in(root: &Path) -> Vec<HistorySession> {
    let mut by_id: HashMap<String, HistorySession> = HashMap::new();
    for path in collect_jsonl_files(root) {
        let Some(session) = scan_file(&path) else {
            continue;
        };
        match by_id.get_mut(&session.id) {
            Some(existing) => {
                if existing.last_active_at < session.last_active_at {
                    existing.last_active_at = session.last_active_at;
                }
            }
            None => {
                by_id.insert(session.id.clone(), session);
            }
        }
    }
    by_id.into_values().collect()
}

/// 按 session_id 找该会话的全部文件（resume 会拆出多个）。删除时一起清掉，
/// 否则只删续写分片，列表里还留着一条指向旧文件的"死"会话。
pub fn find_files(root: &Path, session_id: &str) -> Vec<PathBuf> {
    collect_jsonl_files(root)
        .into_iter()
        .filter(|path| {
            session_id_from_meta(path).as_deref() == Some(session_id)
                || session_id_from_name(path).as_deref() == Some(session_id)
        })
        .collect()
}

fn scan_file(path: &Path) -> Option<HistorySession> {
    let last_active_at = modified_epoch(path);
    let mut meta = Meta::default();
    read_lines_until(path, MAX_SCAN_LINES, |line| {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            return meta.done();
        };
        match record["type"].as_str() {
            Some("session_meta") => take_meta(&record["payload"], &mut meta),
            Some("response_item") => take_user_message(&record["payload"], &mut meta),
            _ => {}
        }
        meta.done()
    });

    let id = meta.session_id.or_else(|| session_id_from_name(path))?;
    Some(HistorySession {
        id,
        title: meta.title.unwrap_or_default(),
        cwd: meta.cwd,
        started_at: meta
            .started_at
            .or((last_active_at > 0).then_some(last_active_at)),
        last_active_at,
    })
}

fn take_meta(payload: &Value, meta: &mut Meta) {
    if meta.session_id.is_none() {
        meta.session_id = payload["session_id"].as_str().map(str::to_string);
    }
    if meta.cwd.is_none() {
        meta.cwd = payload["cwd"].as_str().map(str::to_string);
    }
    if meta.started_at.is_none() {
        meta.started_at = payload["timestamp"].as_str().and_then(parse_rfc3339);
    }
}

fn take_user_message(payload: &Value, meta: &mut Meta) {
    if meta.title.is_some() || payload["role"].as_str() != Some("user") {
        return;
    }
    let Some(parts) = payload["content"].as_array() else {
        return;
    };
    let text = parts
        .iter()
        .filter_map(|part| {
            (part["type"].as_str() == Some("input_text"))
                .then(|| part["text"].as_str().unwrap_or_default())
        })
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() || is_injected(&text) {
        return;
    }
    meta.title = Some(normalize_title(&text));
}

fn is_injected(text: &str) -> bool {
    let trimmed = text.trim_start();
    INJECTED_PREFIXES
        .iter()
        .any(|prefix| trimmed.starts_with(prefix))
}

/// 首行 session_meta 里的 session_id。
fn session_id_from_meta(path: &Path) -> Option<String> {
    let mut found = None;
    read_lines_until(path, 8, |line| {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            return found.is_some();
        };
        if record["type"].as_str() == Some("session_meta") {
            found = record["payload"]["session_id"].as_str().map(str::to_string);
            return true;
        }
        false
    });
    found
}

/// 文件名末 5 段就是 uuid（8-4-4-4-12），与 session_meta 的 session_id 同源。
fn session_id_from_name(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let groups: Vec<&str> = stem.split('-').collect();
    let start = groups.len().checked_sub(5)?;
    Some(groups[start..].join("-"))
}

#[derive(Default)]
struct Meta {
    session_id: Option<String>,
    cwd: Option<String>,
    started_at: Option<i64>,
    title: Option<String>,
}

impl Meta {
    fn done(&self) -> bool {
        self.session_id.is_some() && self.cwd.is_some() && self.title.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("belfry-history-codex-{tag}-{}", std::process::id()));
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
            &[r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"你好"}]}}"#],
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
            &[r#"{"type":"session_meta","payload":{"session_id":"019ff0d5-dbaf-7893-96db-4fbbbfee03a7"}}"#],
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
        let time = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(epoch_seconds as u64);
        let file = std::fs::File::options().write(true).open(path)?;
        file.set_times(std::fs::FileTimes::new().set_modified(time))
    }

}
