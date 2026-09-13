mod client;
mod endpoint;
mod files;
mod leases;
pub(crate) mod lifecycle;
mod protocol;
mod relay;
mod relay_collab;
mod relay_http;
#[cfg(test)]
mod relay_stream_tests;
#[cfg(test)]
mod relay_tests;
mod replay;
mod server;
mod service;
#[cfg(all(test, target_os = "macos"))]
mod service_tests;
mod slot;
mod transport;

pub(crate) use client::DaemonClient;
pub(crate) use leases::LeaseGuard;
pub(crate) use protocol::SessionInfo;
pub(crate) use server::run_if_requested;
