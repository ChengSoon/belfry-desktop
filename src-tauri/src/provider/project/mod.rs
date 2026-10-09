pub mod commands;
mod contracts;
mod launch;
mod service;
mod storage;
pub(crate) use service::prepare;
#[cfg(test)]
mod cli_smoke;
#[cfg(test)]
mod tests;

// Test seam for the encrypted-store → project-launch data path; no AppHandle/home lookup.
#[cfg(test)]
pub(super) fn prepare_synthetic(
    base: &std::path::Path,
    kind: crate::agent::AgentKind,
    provider: &super::contracts::ProviderConfig,
) -> Result<crate::terminal::overlay::LaunchOverlay, crate::terminal::AppError> {
    launch::prepare(base, kind, provider)
}
