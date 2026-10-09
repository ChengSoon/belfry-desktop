// Keep the desktop hook entry compatible with already-installed commands.
// New Windows installations use the lightweight belfry CLI instead of loading the GUI binary.
pub(crate) use belfry_protocol::hooks::run_if_requested;
pub(super) use belfry_protocol::hooks::{ENV_PORT, ENV_TOKEN};
#[cfg(test)]
pub(super) use belfry_protocol::hooks::{read_input, send};
