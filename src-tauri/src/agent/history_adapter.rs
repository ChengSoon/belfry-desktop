use std::path::{Path, PathBuf};

use crate::history::contracts::HistorySession;
use crate::history::{claude, codex};
use crate::terminal::AppError;

pub(crate) trait AgentHistoryAdapter: Send + Sync {
    fn list(&self) -> Vec<HistorySession>;
    fn sessions_root(&self) -> Option<PathBuf>;
    fn find_files(&self, root: &Path, session_id: &str) -> Vec<PathBuf>;
    fn clear(&self) -> Result<u32, AppError>;
}

pub(crate) struct CodexHistoryAdapter;
pub(crate) struct ClaudeHistoryAdapter;

impl AgentHistoryAdapter for CodexHistoryAdapter {
    fn list(&self) -> Vec<HistorySession> {
        codex::scan()
    }

    fn sessions_root(&self) -> Option<PathBuf> {
        crate::history::scan::codex_sessions_root()
    }

    fn find_files(&self, root: &Path, session_id: &str) -> Vec<PathBuf> {
        codex::find_files(root, session_id)
    }

    fn clear(&self) -> Result<u32, AppError> {
        clear_jsonl_root(self.sessions_root())
    }
}

impl AgentHistoryAdapter for ClaudeHistoryAdapter {
    fn list(&self) -> Vec<HistorySession> {
        claude::scan()
    }

    fn sessions_root(&self) -> Option<PathBuf> {
        crate::history::scan::claude_sessions_root()
    }

    fn find_files(&self, root: &Path, session_id: &str) -> Vec<PathBuf> {
        claude::find_files(root, session_id)
    }

    fn clear(&self) -> Result<u32, AppError> {
        clear_jsonl_root(self.sessions_root())
    }
}

fn clear_jsonl_root(root: Option<PathBuf>) -> Result<u32, AppError> {
    let Some(root) = root else {
        return Ok(0);
    };
    let mut removed = 0;
    for path in crate::history::scan::collect_jsonl_files(&root) {
        if crate::history::scan::remove_session_file(&root, &path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}
