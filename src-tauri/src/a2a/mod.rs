//! Project-scoped A2A 1.0 JSON-RPC client. The local gateway is a separate layer.
mod card;
mod client;
pub mod commands;
mod connections;
pub mod contracts;
mod errors;
pub(crate) mod local;
pub(crate) mod platform;
mod redaction;
mod requests;
mod runtime;
mod store;
mod validation;

pub use runtime::A2aRuntime;

#[cfg(test)]
mod tests;
