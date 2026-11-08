use std::path::{Path, PathBuf};

use crate::history::contracts::HistorySession;
use crate::history::{claude, codex, pi};
use crate::terminal::AppError;

pub(crate) trait AgentHistoryAdapter: Send + Sync {
    fn list(&self) -> Vec<HistorySession>;
    fn sessions_root(&self) -> Option<PathBuf>;
    fn find_files(&self, root: &Path, session_id: &str) -> Vec<PathBuf>;
    fn delete(&self, session_id: &str) -> Result<(), AppError> {
        let root = self
            .sessions_root()
            .ok_or_else(|| AppError::not_found("session directory was not found"))?;
        let files = self.find_files(&root, session_id);
        if files.is_empty() {
            return Err(AppError::not_found("session was not found"));
        }
        for file in files {
            crate::history::scan::remove_session_file(&root, &file)?;
        }
        Ok(())
    }
    fn clear(&self) -> Result<u32, AppError>;
}

pub(crate) struct CodexHistoryAdapter;
pub(crate) struct ClaudeHistoryAdapter;
pub(crate) struct PiHistoryAdapter;
pub(crate) struct NativeHistoryAdapter(pub crate::agent::AgentKind);

impl AgentHistoryAdapter for NativeHistoryAdapter {
    fn list(&self) -> Vec<HistorySession> {
        crate::history::native::list(self.0)
    }
    fn sessions_root(&self) -> Option<PathBuf> {
        crate::history::native::root(self.0)
    }
    fn find_files(&self, root: &Path, session_id: &str) -> Vec<PathBuf> {
        let path = crate::history::native::cache_file(root, session_id);
        path.is_file().then_some(path).into_iter().collect()
    }
    fn delete(&self, session_id: &str) -> Result<(), AppError> {
        crate::history::native::delete(self.0, session_id)
    }
    fn clear(&self) -> Result<u32, AppError> {
        crate::history::native::clear(self.0)
    }
}

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

impl AgentHistoryAdapter for PiHistoryAdapter {
    fn list(&self) -> Vec<HistorySession> {
        pi::scan()
    }

    fn sessions_root(&self) -> Option<PathBuf> {
        crate::history::scan::pi_sessions_root()
    }

    fn find_files(&self, root: &Path, session_id: &str) -> Vec<PathBuf> {
        pi::find_files(root, session_id)
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
