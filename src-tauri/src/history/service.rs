//! 编排历史会话的列取与删除。

use crate::agent::{AgentKind, adapter_for};
use crate::terminal::AppError;

use super::contracts::HistorySession;
use super::scan::{remove_session_file, validate_session_id};

/// 列出某 Agent 的全部历史会话，按最后活跃时间倒序。
pub fn list(agent: AgentKind) -> Vec<HistorySession> {
    let mut sessions = adapter_for(agent).history().list();
    sessions.sort_by_key(|session| std::cmp::Reverse(session.last_active_at));
    sessions
}

/// 删除指定会话（含 resume 拆出的全部文件）。会话不存在时返回 NotFound，
/// 前端据此提示"已被删除"。
pub fn delete(agent: AgentKind, session_id: &str) -> Result<(), AppError> {
    validate_session_id(session_id)?;
    let history = adapter_for(agent).history();
    let root = history.sessions_root();
    let Some(root) = root else {
        return Err(AppError::not_found("session directory was not found"));
    };
    let files = history.find_files(&root, session_id);
    if files.is_empty() {
        return Err(AppError::not_found("session was not found"));
    }
    for path in files {
        remove_session_file(&root, &path)?;
    }
    Ok(())
}

/// 清空某 Agent 的全部会话，返回删除的文件数。
pub fn clear(agent: AgentKind) -> Result<u32, AppError> {
    adapter_for(agent).history().clear()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 临时交叉校验用：`cargo test history::service -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn dump_real_sessions() {
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let sessions = list(agent);
            println!("{agent:?}: {} sessions", sessions.len());
            for session in sessions.iter().take(3) {
                println!(
                    "  {} | {} | {}",
                    session.id,
                    session.title,
                    session.cwd.as_deref().unwrap_or("(no cwd)")
                );
            }
        }
    }
}
