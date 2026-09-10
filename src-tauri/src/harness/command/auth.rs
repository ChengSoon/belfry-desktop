use super::{CommandError, CommandResult, ExecRequest};
use crate::harness::registry::{SessionSnapshot, SystemRegistry};

pub(super) fn authorize(
    registry: &SystemRegistry,
    request: &ExecRequest,
) -> CommandResult<SessionSnapshot> {
    let session = registry
        .session(&request.session_id)
        .ok_or_else(|| CommandError::new("SESSION_NOT_FOUND", "session not found"))?;
    if session.worker_id != request.worker_id {
        return Err(CommandError::new(
            "WORKER_MISMATCH",
            "worker does not own session",
        ));
    }
    if !session
        .plugin
        .tools
        .iter()
        .any(|tool| tool == "command.exec")
    {
        return Err(CommandError::new(
            "TOOL_UNDECLARED",
            "command.exec is not declared",
        ));
    }
    if !session.grants.iter().any(|grant| grant == "command.exec") {
        return Err(CommandError::new(
            "CAPABILITY_DENIED",
            "command execution is not authorized",
        ));
    }
    if session.cancelled || !session.resumable {
        return Err(CommandError::new(
            "SESSION_CANCELLED",
            "session is cancelled",
        ));
    }
    Ok(session)
}
