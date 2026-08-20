use super::adapter::{adapter_for, detect_all};
use super::contracts::{AgentAvailability, AgentDescriptor, AgentKind, AgentResumePlan};
use crate::terminal::AppError;

#[tauri::command]
pub async fn agent_detect() -> Vec<AgentAvailability> {
    // `detect_agents` 会启动 agent 的 `--version` 子进程。在 Windows 上一次 Node CLI
    // 冷启动常常需要一秒以上；同步 command 会占住 WebView 的 IPC 事件线程，窗口因此
    // 在首屏期间表现为“未响应”。明确放进 blocking 池，探测慢也不影响窗口绘制和输入。
    tauri::async_runtime::spawn_blocking(detect_all)
        .await
        .unwrap_or_else(|error| {
            AgentKind::ALL
                .into_iter()
                .map(|kind| AgentAvailability {
                    descriptor: AgentDescriptor::for_kind(kind),
                    kind,
                    available: false,
                    executable: None,
                    version: None,
                    reason: Some(format!("agent detection failed: {error}")),
                })
                .collect()
        })
}

#[tauri::command]
pub fn agent_descriptors() -> Vec<AgentDescriptor> {
    super::descriptors()
}

#[tauri::command]
pub fn agent_resume_plan(
    agent: AgentKind,
    session_id: String,
) -> Result<AgentResumePlan, AppError> {
    adapter_for(agent).plan_resume(&session_id)
}
