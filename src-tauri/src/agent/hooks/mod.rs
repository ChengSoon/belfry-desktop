pub mod commands;
mod config;
mod contracts;
pub(super) mod features;
mod helper;
mod input;
mod install;
mod machine;
mod registry;
mod runtime;
mod server;
mod settings;

pub(crate) use contracts::HookSnapshot;
pub(crate) use helper::run_if_requested;
pub(crate) use runtime::{HookConnection, HookRuntime};

#[cfg(test)]
mod config_tests;
#[cfg(test)]
mod core_tests;
#[cfg(test)]
mod edge_tests;
#[cfg(test)]
mod install_tests;
#[cfg(test)]
mod registry_tests;
#[cfg(test)]
mod transport_tests;
