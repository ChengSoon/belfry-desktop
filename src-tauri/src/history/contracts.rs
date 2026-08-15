use serde::Serialize;

/// 一条历史会话的元数据。`id` 是 resume / delete 用的会话标识：
/// Codex 取日志 `session_meta` 里的 session_id，Claude 取文件名主干（去 `.jsonl`）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySession {
    pub id: String,
    /// 会话首条用户消息提炼出的标题；读不到用户消息时为空串。
    pub title: String,
    /// 会话所在的工程目录，读不到时为空（目录可能已被移动或删除）。
    pub cwd: Option<String>,
    /// 会话开始时间（epoch 秒）。
    pub started_at: Option<i64>,
    /// 最后活跃时间（epoch 秒），取文件 mtime，始终可用。
    pub last_active_at: i64,
}
