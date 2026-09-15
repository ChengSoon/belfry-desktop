use super::TerminalRuntime;
use tauri::State;

/// 严格确认当前连接最早未消费的批次；错误身份和重复/乱序确认不释放额度。
#[tauri::command]
pub fn terminal_ack_output(
    runtime: State<'_, TerminalRuntime>,
    session_id: String,
    connection_id: String,
    delivery_id: u64,
) -> bool {
    runtime.acknowledge_output(&session_id, &connection_id, delivery_id)
}
