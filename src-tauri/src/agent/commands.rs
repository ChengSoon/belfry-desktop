use super::contracts::AgentAvailability;
use super::detection::detect_agents;

#[tauri::command]
pub fn agent_detect() -> Vec<AgentAvailability> {
    detect_agents()
}
